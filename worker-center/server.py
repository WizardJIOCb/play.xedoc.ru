"""Loopback-only Windows worker dashboard. Python standard library, no dependencies."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import threading
import time
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parent
STATE = Path(os.environ.get('LOCALAPPDATA', str(ROOT))) / 'XEDOCWorkerCenter'
PS = str(Path(os.environ.get('WINDIR', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
HIDDEN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
HTTP = build_opener(ProxyHandler({}))


def ps_command(script, *args):
    return [PS, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script), *args]


def catalog():
    rag = Path(r'C:\Projects\rag')
    studio = Path(r'C:\Projects\models.xedoc.ru')
    comfy = Path(r'C:\Projects\comfy')
    music = ROOT.parent / 'worker/music-worker.ps1'
    def item(id, name, group, description, path, health=None, **extra):
        return dict(id=id, name=name, group=group, description=description, path=str(path), health=health, **extra)
    return [
        item('yue2', 'YuE2 · Музыка', 'Генерация', 'Принимает задания с play.xedoc.ru и создаёт песни на вашей видеокарте.', music,
             task='XEDOC Play YuE2 worker', match=str(music), url='https://play.xedoc.ru/generate', config=r'C:\ProgramData\XEDOCPlay\music-worker.json'),
        item('comfy', 'ComfyUI', 'Генерация', 'Изображения, видео и Pixal3D. Запуск включает существующий туннель.', comfy / 'scripts/start-comfy-tunnel.ps1', 'http://127.0.0.1:8188/system_stats',
             task='ComfyUI local and tunnel', match=str(comfy / 'ComfyUI/main.py'), marker='system', url='http://127.0.0.1:8188', logs=[str(comfy / 'logs/comfy-tunnel.log')]),
        item('studio', 'Model Studio', 'Генерация', '3D-модели, скелет и анимация. Запуск также поднимает ComfyUI, Kimodo и туннели.', studio / 'scripts/Start-Studio.ps1', 'http://127.0.0.1:8095/api/model-studio/health',
             match=str(studio / 'studio/server.py'), marker='service', expected='model-studio', args=['-NoBrowser'], url='https://models.xedoc.ru', logs=[str(studio / '.runtime/server.stderr.log')]),
        item('kimodo', 'Kimodo · Движение', 'Генерация', 'Локальный движок генерации движений для Model Studio.', studio / 'scripts/Start-Kimodo.ps1', 'http://127.0.0.1:8094/api/models',
             match='kimodo-demo.exe', marker='models', args=['-NoBrowser'], url='http://127.0.0.1:8094'),
        item('ollama', 'Ollama', 'Модели и RAG', 'Локальные языковые модели в контейнере rag-ollama. Запуск сервера не загружает модель в GPU.', rag / 'compose.yaml', 'http://127.0.0.1:11434/api/version',
             marker='version', command=['docker', 'compose', 'up', '-d', '--no-deps', '--pull', 'never', 'ollama'], cwd=str(rag)),
        item('gptoss', 'GPT-OSS', 'Модели и RAG', 'Локальный llama.cpp сервер. При запуске модель занимает видеопамять.', rag / 'scripts/start-gpt-oss.ps1', 'http://127.0.0.1:11435/health',
             match='--port 11435', marker='status', expected='ok', logs=[str(rag / 'logs/gpt-oss-llama-server.err.log')]),
        item('codex', 'ChatGPT Gateway', 'Модели и RAG', 'Подключение моделей через существующую авторизацию Codex для RAG.', rag / 'scripts/start-codex-gateway.ps1', 'http://127.0.0.1:11436/health',
             match=str(rag / 'gateway/codex-gateway.mjs'), marker='status', expected=True, logs=[str(rag / 'logs/codex-gateway.err.log')]),
        item('giga', 'GigaEmbeddings', 'Модели и RAG', 'Векторный поиск по документам. Модель загружается по запросу.', rag / 'scripts/start-giga-embeddings-gateway.ps1', 'http://127.0.0.1:11437/health',
             match=str(rag / 'gateway/giga-embeddings-gateway.py'), marker='status', expected='ok', logs=[str(rag / 'logs/giga-embeddings-gateway.error.log')]),
        item('rag', 'Open WebUI · RAG', 'Модели и RAG', 'Интерфейс чата и документов. Запуск включает стек RAG, шлюзы и туннель.', rag / 'deploy/rag.xedoc.ru/windows/start-rag-tunnel.ps1', 'http://127.0.0.1:3000/health',
             task='RAG xedoc reverse tunnel', match=str(rag / 'deploy/rag.xedoc.ru/windows/start-rag-tunnel.ps1'), marker='status', expected=True, url='https://rag.xedoc.ru', logs=[str(rag / 'logs/rag-xedoc-tunnel.log')]),
    ]


def request_json(url):
    with HTTP.open(url, timeout=3) as response:
        return json.load(response)


def run(command, timeout=20):
    result = subprocess.run(command, capture_output=True, timeout=timeout, creationflags=HIDDEN)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace')[-1200:] or 'Команда завершилась с ошибкой')
    return result.stdout.decode('utf-8-sig', errors='replace')


def redact(text):
    text = re.sub(r'(?i)(bearer\s+)\S+', r'\1[скрыто]', text)
    return re.sub(r'(?i)((?:token|password|api[_-]?key|secret)[\s"\x27:=]+)[^\s,"\x27]+', r'\1[скрыто]', text)


class Center:
    def __init__(self, workers=None, state_dir=STATE):
        self.workers = workers if workers is not None else catalog()
        self.directory = state_dir
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.pending = {}
        self.failures = {}
        self.snapshot = dict(workers=[], gpu=[], loading=True, updatedAt=None)
        self.events = []
        self.token = secrets.token_urlsafe(32)

    def inventory(self):
        return json.loads(run(ps_command(ROOT / 'inventory.ps1')))

    def inspect(self, worker, inventory):
        result = {key: worker[key] for key in ('id', 'name', 'group', 'description', 'path')}
        result['url'] = worker.get('url')
        missing = [] if Path(worker['path']).exists() else [worker['path']]
        if worker.get('config'):
            try:
                config = json.loads(Path(worker['config']).read_text(encoding='utf-8-sig'))
                for key in ('cliPath', 'modelPath'):
                    if not config.get(key) or not Path(config[key]).exists():
                        missing.append(key)
                if not config.get('token') or not config.get('apiBase') or not config.get('outputPath'):
                    missing.append('Настройки подключения YuE2')
            except (OSError, ValueError):
                missing.append('Конфигурация YuE2')
        needles = [worker.get('match', ''), worker['path'] if worker['path'].endswith('.ps1') else '']
        needles = [n.replace('/', '\\').lower() for n in needles if n]
        processes = [p for p in inventory.get('processes', []) if any(n in (p.get('CommandLine') or '').replace('/', '\\').lower() for n in needles) and p['Name'].lower() in ('powershell.exe', 'pwsh.exe', 'python.exe', 'node.exe', 'llama-server.exe', 'kimodo-demo.exe')]
        task = next((t for t in inventory.get('tasks', []) if t['name'] == worker.get('task')), None)
        if worker.get('task') and not task:
            missing.append('Задача Windows: ' + worker['task'])
        result.update(pids=[p['ProcessId'] for p in processes], task=task, missing=missing)
        alive = bool(processes) or bool(task and task['state'] == 'Running')
        healthy = False
        data = {}
        if worker.get('health'):
            try:
                data = request_json(worker['health'])
                healthy = isinstance(data, dict) and worker['marker'] in data and ('expected' not in worker or data[worker['marker']] == worker['expected'])
                if worker['id'] == 'kimodo':
                    healthy = isinstance(data, list) and any(isinstance(m, dict) and m.get('id') == 'smplx-rp-v1' and m.get('available') is True for m in data)
            except Exception:
                pass
        status = 'running' if healthy or (not worker.get('health') and alive) else 'degraded' if alive else 'missing' if missing else 'stopped'
        detail = 'Сервис отвечает' if healthy else 'Процесс запущен; связь с очередью не проверена' if status == 'running' else 'Процесс есть, но сервис не отвечает' if alive else 'Готов к запуску' if not missing else 'Не найдены необходимые файлы'
        if worker['id'] == 'yue2' and alive and any(p['Name'] == 'audiocpp_cli.exe' and '--family yue2' in (p.get('CommandLine') or '') for p in inventory.get('processes', [])):
            status, detail = 'busy', 'YuE2 выполняет генерацию на этом компьютере'
        if worker['id'] == 'comfy' and healthy:
            try:
                queue = request_json('http://127.0.0.1:8188/queue')
                count = len(queue.get('queue_running', []))
                if count:
                    status, detail = 'busy', f'Выполняется заданий: {count}'
            except Exception:
                pass
        if worker['id'] == 'studio' and healthy:
            if data.get('gpu', {}).get('busy'):
                status, detail = 'busy', 'Выполняется операция: ' + str(data['gpu'].get('operation') or 'генерация')
            elif not data.get('comfy', {}).get('online') or not data.get('kimodo', {}).get('online'):
                status, detail = 'degraded', 'Studio отвечает, но не все движки доступны'
        with self.lock:
            if status in ('running', 'busy'):
                self.failures.pop(worker['id'], None)
            pending = self.pending.get(worker['id'])
            if pending:
                process, started = pending
                code = process.poll()
                if status in ('running', 'busy'):
                    self.pending.pop(worker['id'], None)
                elif code is not None and code != 0:
                    self.pending.pop(worker['id'], None)
                    self.event(worker['name'] + f': ошибка запуска, код {code}. Откройте журнал.')
                    status, detail = 'error', f'Ошибка запуска (код {code}). Откройте журнал.'
                    self.failures[worker['id']] = detail
                elif time.monotonic() - started > 240:
                    self.pending.pop(worker['id'], None)
                    status, detail = 'degraded', 'Запуск не подтверждён за 4 минуты. Откройте журнал.'
                    self.failures[worker['id']] = detail
                else:
                    status, detail = 'starting', 'Запускается. Ожидаем подтверждения готовности…'
            if worker['id'] in self.failures and not pending and status == 'stopped':
                status, detail = 'error', self.failures[worker['id']]
        result.update(status=status, detail=detail, canStart=not missing and status in ('stopped', 'error') and not alive)
        return result

    def event(self, message):
        event = dict(at=datetime.now().strftime('%H:%M:%S'), message=redact(message))
        with self.lock:
            self.events = [event, *self.events][:30]
            with (self.directory / 'actions.log').open('a', encoding='utf-8') as out:
                out.write(json.dumps(event, ensure_ascii=False) + '\n')

    def refresh(self):
        inventory = self.inventory()
        with ThreadPoolExecutor(max_workers=12) as pool:
            workers = list(pool.map(lambda w: self.inspect(w, inventory), self.workers))
        gpu = []
        try:
            rows = run(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'], timeout=5)
            for line in rows.strip().splitlines():
                name, usage, used, total, temperature = [part.strip() for part in line.split(',')]
                gpu.append(dict(name=name, usage=int(usage), used=int(used), total=int(total), temperature=int(temperature)))
        except Exception:
            pass
        with self.lock:
            self.snapshot = dict(workers=workers, gpu=gpu, computer=inventory.get('computer', ''), loading=False, updatedAt=datetime.now(timezone.utc).isoformat())

    def watch(self):
        while True:
            try:
                self.refresh()
            except Exception as error:
                with self.lock:
                    self.snapshot = {**self.snapshot, 'error': redact(str(error))}
            time.sleep(5)

    def start(self, worker_id):
        worker = next((w for w in self.workers if w['id'] == worker_id), None)
        if worker is None:
            raise ValueError('Неизвестный воркер')
        with self.lock:
            if worker_id in self.pending:
                return 'Запуск уже выполняется'
            current = self.inspect(worker, self.inventory())
            if current['status'] in ('running', 'busy'):
                return 'Уже запущен'
            if not current['canStart']:
                raise ValueError(current['detail'])
            if worker.get('task'):
                command = ['schtasks.exe', '/Run', '/TN', worker['task']]
            else:
                command = worker.get('command') or ps_command(worker['path'], *worker.get('args', []))
            with (self.directory / (worker_id + '.log')).open('ab') as out:
                process = subprocess.Popen(command, cwd=worker.get('cwd', str(Path(worker['path']).parent)), stdout=out, stderr=subprocess.STDOUT, creationflags=HIDDEN)
            self.pending[worker_id] = (process, time.monotonic())
            self.failures.pop(worker_id, None)
            self.snapshot = {**self.snapshot, 'workers': [dict(w, status='starting', detail='Ожидаем подтверждения запуска…', canStart=False) if w['id'] == worker_id else w for w in self.snapshot['workers']]}
            self.event(worker['name'] + ': отправлена команда запуска')
            return 'Команда запуска отправлена'

    def logs(self, worker_id):
        worker = next((w for w in self.workers if w['id'] == worker_id), None)
        if worker is None:
            raise ValueError('Неизвестный воркер')
        output = []
        for filename in [self.directory / (worker_id + '.log'), *map(Path, worker.get('logs', []))]:
            if filename.is_file():
                with filename.open('rb') as source:
                    source.seek(max(0, filename.stat().st_size - 12000))
                    raw = source.read()
                try:
                    body = raw.decode('utf-8-sig')
                except UnicodeDecodeError:
                    body = raw.decode('cp866', errors='replace')
                output.append(filename.name + '\n' + redact(body))
        return '\n\n'.join(output) or 'Пока нет записей. Здесь появится результат запуска из центра.'


def handler(center, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def allowed(self, mutation=False):
            if self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
                return False
            if mutation:
                origin = self.headers.get('Origin')
                if origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
                    return False
                return secrets.compare_digest(self.headers.get('X-Center-Token', ''), center.token)
            return self.headers.get('Sec-Fetch-Site') != 'cross-site'

        def send(self, code, payload, content_type='application/json; charset=utf-8'):
            body = payload.encode('utf-8') if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.allowed():
                return self.send(403, {'error': 'Доступ только с этого компьютера'})
            route = self.path.split('?')[0]
            if route == '/api/health':
                return self.send(200, {'service': 'xedoc-worker-center'})
            if route == '/api/status':
                with center.lock:
                    result = dict(center.snapshot, events=center.events, token=center.token)
                return self.send(200, result)
            match = re.fullmatch(r'/api/workers/([a-z0-9-]+)/logs', route)
            if match:
                try:
                    return self.send(200, {'text': center.logs(match[1])})
                except ValueError as error:
                    return self.send(404, {'error': str(error)})
            static = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}
            if route in static:
                filename, mime = static[route]
                return self.send(200, (ROOT / filename).read_text(encoding='utf-8'), mime + '; charset=utf-8')
            self.send(404, {'error': 'Не найдено'})

        def do_POST(self):
            if not self.allowed(mutation=True):
                return self.send(403, {'error': 'Недопустимый источник запроса'})
            match = re.fullmatch(r'/api/workers/([a-z0-9-]+)/start', self.path)
            if not match:
                return self.send(404, {'error': 'Не найдено'})
            try:
                return self.send(202, {'message': center.start(match[1])})
            except ValueError as error:
                return self.send(409, {'error': str(error)})
            except Exception as error:
                return self.send(500, {'error': redact(str(error))})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8787)
    args = parser.parse_args()
    center = Center()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(center, args.port))
    threading.Thread(target=center.watch, daemon=True).start()
    server.serve_forever()


if __name__ == '__main__':
    main()
