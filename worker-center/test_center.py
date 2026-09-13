import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

import server


class CenterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.worker = dict(id='test', name='Test worker', group='Test', description='Fixture', path=__file__, health='http://127.0.0.1:1/health', marker='status', expected='ok', match='fixture-worker-marker')
        self.center = server.Center([self.worker], self.directory)
        self.empty = dict(processes=[], tasks=[])

    def tearDown(self):
        for process, _ in self.center.pending.values():
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=10)
        self.temp.cleanup()

    def test_process_without_health_is_not_startable(self):
        inventory = dict(self.empty, processes=[dict(Name='python.exe', ProcessId=12, CommandLine='python fixture-worker-marker')])
        with patch.object(server, 'request_json', side_effect=OSError('offline')):
            result = self.center.inspect(self.worker, inventory)
        self.assertEqual(result['status'], 'degraded')
        self.assertFalse(result['canStart'])

    def test_task_ready_does_not_hide_running_worker(self):
        worker = dict(self.worker, health=None, task='Existing task')
        inventory = dict(processes=[dict(Name='powershell.exe', ProcessId=12, CommandLine='fixture-worker-marker')], tasks=[dict(name='Existing task', state='Ready', result=0)])
        self.assertEqual(self.center.inspect(worker, inventory)['status'], 'running')

    def test_kimodo_array_response(self):
        worker = dict(self.worker, id='kimodo')
        with patch.object(server, 'request_json', return_value=[dict(id='smplx-rp-v1', available=True)]):
            self.assertEqual(self.center.inspect(worker, self.empty)['status'], 'running')

    def test_unknown_service_on_port_is_not_healthy(self):
        with patch.object(server, 'request_json', return_value={'status': 'wrong-service'}):
            self.assertNotEqual(self.center.inspect(self.worker, self.empty)['status'], 'running')

    def test_real_launch_and_duplicate_suppression(self):
        result_path = self.directory / 'fixture-result.txt'
        fixture = self.directory / 'fixture.py'
        fixture.write_text('import pathlib,time,sys\npathlib.Path(sys.argv[1]).write_text("started")\nprint("fixture started", flush=True)\ntime.sleep(1)\n')
        self.worker['command'] = [sys.executable, str(fixture), str(result_path)]
        with patch.object(self.center, 'inventory', return_value=self.empty), patch.object(server, 'request_json', side_effect=OSError()):
            self.center.start('test')
            process = self.center.pending['test'][0]
            self.assertEqual(self.center.start('test'), 'Запуск уже выполняется')
            process.wait(timeout=10)
            self.assertEqual(result_path.read_text(), 'started')
            self.assertIn('fixture started', self.center.logs('test'))

    def test_failed_launch_stays_visible_and_can_retry(self):
        process = Mock()
        process.poll.return_value = 7
        self.center.pending['test'] = (process, 0)
        with patch.object(server, 'request_json', side_effect=OSError()):
            first = self.center.inspect(self.worker, self.empty)
            second = self.center.inspect(self.worker, self.empty)
        self.assertEqual(first['status'], 'error')
        self.assertEqual(second['status'], 'error')
        self.assertTrue(second['canStart'])

    def test_no_arbitrary_ids(self):
        with self.assertRaises(ValueError):
            self.center.start('../powershell')
        with self.assertRaises(ValueError):
            self.center.logs('../secrets')

    def test_logs_redact_credentials(self):
        (self.directory / 'test.log').write_text('Authorization: Bearer ABC123\ntoken=PRIVATE\nnormal output', encoding='utf-8')
        output = self.center.logs('test')
        self.assertNotIn('ABC123', output)
        self.assertNotIn('PRIVATE', output)
        self.assertIn('normal output', output)

    def test_http_origin_token_and_host(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.handler(self.center, 0))
        port = httpd.server_address[1]
        httpd.RequestHandlerClass = server.handler(self.center, port)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        def request(method, path, headers=None):
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
            try:
                connection.request(method, path, headers=headers or {})
                response = connection.getresponse()
                body = response.read()
                return response.status, json.loads(body)
            finally:
                connection.close()
        try:
            with patch.object(self.center, 'start', return_value='accepted') as start:
                self.assertEqual(request('GET', '/api/status', {'Host': 'evil.example'})[0], 403)
                self.assertEqual(request('GET', '/api/status', {'Sec-Fetch-Site': 'cross-site'})[0], 403)
                self.assertEqual(request('POST', '/api/workers/test/start')[0], 403)
                self.assertEqual(request('POST', '/api/workers/test/start', {'Origin': 'https://evil.example', 'X-Center-Token': self.center.token})[0], 403)
                start.assert_not_called()
                headers = {'Origin': f'http://127.0.0.1:{port}', 'X-Center-Token': self.center.token}
                self.assertEqual(request('POST', '/api/workers/test/start', headers)[0], 202)
                start.assert_called_once_with('test')
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=10)


if __name__ == '__main__':
    unittest.main()
