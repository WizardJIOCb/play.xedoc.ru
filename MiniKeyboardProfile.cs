using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

internal static class MiniKeyboardProfile
{
    private const ushort VendorId = 0x1189;
    private const ushort ProductId = 0x8842;
    private const int LayerCount = 3;
    private const int RecordsPerLayer = 24;
    private const int ReportLength = 65;

    [DllImport("hidapi.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int hid_init();

    [DllImport("hidapi.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr hid_open(ushort vendorId, ushort productId, IntPtr serialNumber);

    [DllImport("hidapi.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int hid_write(IntPtr device, byte[] data, UIntPtr length);

    [DllImport("hidapi.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int hid_read_timeout(IntPtr device, byte[] data, UIntPtr length, int milliseconds);

    [DllImport("hidapi.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void hid_close(IntPtr device);

    [DllImport("hidapi.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int hid_exit();

    private sealed class DesiredRecord
    {
        public byte KeyId;
        public byte[] WriteReport;
        public string Label;
    }

    private static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            PrintUsage();
            return 2;
        }

        if (hid_init() != 0)
        {
            Console.Error.WriteLine("hid_init failed");
            return 3;
        }

        IntPtr device = hid_open(VendorId, ProductId, IntPtr.Zero);
        if (device == IntPtr.Zero)
        {
            Console.Error.WriteLine("Could not open MINI_KEYBOARD (VID 1189 / PID 8842)");
            hid_exit();
            return 4;
        }

        try
        {
            string mode = args[0].ToLowerInvariant();
            if (mode == "read")
            {
                PrintProfile(ReadProfile(device));
                return 0;
            }

            if (mode == "configure" && args.Length == 2)
            {
                Configure(device, args[1]);
                return 0;
            }

            if (mode == "restore" && args.Length == 2)
            {
                List<byte[]> backup = LoadBackup(args[1]);
                WriteResponseRecords(device, backup);
                Console.WriteLine("RESTORED " + Path.GetFullPath(args[1]));
                return 0;
            }

            PrintUsage();
            return 2;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 5;
        }
        finally
        {
            hid_close(device);
            hid_exit();
        }
    }

    private static void Configure(IntPtr device, string backupPath)
    {
        List<byte[]> before = ReadProfile(device);
        SaveBackup(backupPath, before);
        Console.WriteLine("BACKUP " + Path.GetFullPath(backupPath));

        List<DesiredRecord> desired = BuildDesiredProfile();
        bool writeStarted = false;
        try
        {
            foreach (DesiredRecord item in desired)
            {
                Write(device, item.WriteReport);
                writeStarted = true;
            }
            WriteTerminator(device);
            Thread.Sleep(400);

            List<byte[]> after = ReadProfile(device);
            VerifyDesired(after, desired);
            VerifyUntouched(before, after, desired.Select(d => d.KeyId));

            Console.WriteLine("VERIFIED");
            foreach (DesiredRecord item in desired)
                Console.WriteLine(item.Label);
        }
        catch
        {
            if (writeStarted)
            {
                try
                {
                    WriteResponseRecords(device, before);
                    Console.Error.WriteLine("The original profile was restored after a failed verification.");
                }
                catch (Exception restoreError)
                {
                    Console.Error.WriteLine("Automatic restore also failed: " + restoreError.Message);
                }
            }
            throw;
        }
    }

    private static List<DesiredRecord> BuildDesiredProfile()
    {
        const byte layer = 1;
        return new List<DesiredRecord>
        {
            Mouse(0x12, layer, 0x02, 0x01, "Upper small left: horizontal scroll left"),
            BasicNull(0x11, layer, "Upper small press: NULL"),
            Mouse(0x10, layer, 0x02, 0xFF, "Upper small right: horizontal scroll right"),

            Multimedia(0x15, layer, 0x00B6, "Medium left: previous track"),
            BasicNull(0x14, layer, "Medium press: NULL"),
            Multimedia(0x13, layer, 0x00B5, "Medium right: next track"),

            Mouse(0x16, layer, 0x00, 0x01, "Lower small left: vertical scroll up"),
            BasicNull(0x17, layer, "Lower small press: NULL"),
            Mouse(0x18, layer, 0x00, 0xFF, "Lower small right: vertical scroll down")
        };
    }

    private static DesiredRecord BasicNull(byte keyId, byte layer, string label)
    {
        byte[] report = NewWriteReport(keyId, layer, 0x01);
        report[10] = 0x01;
        report[11] = 0x00;
        report[12] = 0x00;
        return new DesiredRecord { KeyId = keyId, WriteReport = report, Label = label };
    }

    private static DesiredRecord Multimedia(byte keyId, byte layer, ushort usage, string label)
    {
        byte[] report = NewWriteReport(keyId, layer, 0x02);
        report[10] = 0x01;
        report[11] = (byte)(usage & 0xFF);
        report[12] = (byte)(usage >> 8);
        return new DesiredRecord { KeyId = keyId, WriteReport = report, Label = label };
    }

    private static DesiredRecord Mouse(byte keyId, byte layer, byte modifier, byte wheel, string label)
    {
        byte[] report = NewWriteReport(keyId, layer, 0x03);
        report[10] = 0x04;
        report[11] = modifier;
        report[15] = wheel;
        return new DesiredRecord { KeyId = keyId, WriteReport = report, Label = label };
    }

    private static byte[] NewWriteReport(byte keyId, byte layer, byte actionType)
    {
        byte[] report = new byte[ReportLength];
        report[0] = 0x03;
        report[1] = 0xFD;
        report[2] = keyId;
        report[3] = layer;
        report[4] = actionType;
        return report;
    }

    private static List<byte[]> ReadProfile(IntPtr device)
    {
        List<byte[]> profile = new List<byte[]>(LayerCount * RecordsPerLayer);
        for (int layer = 1; layer <= LayerCount; layer++)
        {
            byte[] command = new byte[ReportLength];
            command[0] = 0x03;
            command[1] = 0xFA;
            command[2] = 0x0F;
            command[3] = 0x03;
            command[4] = (byte)layer;
            Write(device, command);

            for (int recordIndex = 0; recordIndex < RecordsPerLayer; recordIndex++)
            {
                byte[] response = new byte[ReportLength];
                int read = hid_read_timeout(device, response, (UIntPtr)64, 1500);
                if (read <= 0)
                    throw new InvalidOperationException("Timed out reading layer " + layer + ", record " + (recordIndex + 1));
                if (response[0] != 0x03 || response[1] != 0xFA)
                    throw new InvalidDataException("Unexpected profile response header");
                profile.Add(response);
            }
        }
        return profile;
    }

    private static void VerifyDesired(List<byte[]> after, List<DesiredRecord> desired)
    {
        foreach (DesiredRecord item in desired)
        {
            byte[] actual = Find(after, 1, item.KeyId);
            byte[] expected = (byte[])item.WriteReport.Clone();
            expected[1] = 0xFA;
            for (int i = 0; i < 50; i++)
            {
                if (actual[i] != expected[i])
                    throw new InvalidDataException(
                        "Verification mismatch for key 0x" + item.KeyId.ToString("X2") +
                        " at byte " + i +
                        "; expected=" + expected[i].ToString("X2") +
                        ", actual=" + actual[i].ToString("X2") +
                        "; actual record=" + BitConverter.ToString(actual, 0, 20).Replace('-', ' '));
            }
        }
    }

    private static void VerifyUntouched(List<byte[]> before, List<byte[]> after, IEnumerable<byte> changedKeyIds)
    {
        HashSet<byte> changed = new HashSet<byte>(changedKeyIds);
        foreach (byte[] oldRecord in before)
        {
            byte layer = oldRecord[3];
            byte keyId = oldRecord[2];
            if (layer == 1 && changed.Contains(keyId))
                continue;

            byte[] newRecord = Find(after, layer, keyId);
            for (int i = 0; i < 50; i++)
            {
                if (oldRecord[i] != newRecord[i])
                    throw new InvalidDataException("An untouched record changed: layer " + layer + ", key 0x" + keyId.ToString("X2"));
            }
        }
    }

    private static byte[] Find(List<byte[]> profile, byte layer, byte keyId)
    {
        byte[] result = profile.FirstOrDefault(r => r[3] == layer && r[2] == keyId);
        if (result == null)
            throw new InvalidDataException("Record not found: layer " + layer + ", key 0x" + keyId.ToString("X2"));
        return result;
    }

    private static void WriteResponseRecords(IntPtr device, List<byte[]> responses)
    {
        foreach (byte[] response in responses)
        {
            byte[] report = new byte[ReportLength];
            Array.Copy(response, report, Math.Min(response.Length, report.Length));
            report[0] = 0x03;
            report[1] = 0xFD;
            Write(device, report);
        }
        WriteTerminator(device);
        Thread.Sleep(400);
    }

    private static void WriteTerminator(IntPtr device)
    {
        byte[] terminator = new byte[ReportLength];
        terminator[0] = 0x03;
        terminator[1] = 0xFD;
        terminator[2] = 0xFE;
        terminator[3] = 0xFF;
        Write(device, terminator);
    }

    private static void Write(IntPtr device, byte[] report)
    {
        int written = hid_write(device, report, (UIntPtr)report.Length);
        if (written < 0)
            throw new IOException("HID write failed");
    }

    private static void SaveBackup(string path, List<byte[]> profile)
    {
        using (FileStream stream = File.Create(path))
        using (BinaryWriter writer = new BinaryWriter(stream))
        {
            writer.Write(new byte[] { (byte)'M', (byte)'K', (byte)'P', (byte)'1' });
            writer.Write(profile.Count);
            foreach (byte[] record in profile)
                writer.Write(record, 0, record.Length);
        }
    }

    private static List<byte[]> LoadBackup(string path)
    {
        using (FileStream stream = File.OpenRead(path))
        using (BinaryReader reader = new BinaryReader(stream))
        {
            string magic = new string(reader.ReadChars(4));
            if (magic != "MKP1")
                throw new InvalidDataException("Invalid backup file");
            int count = reader.ReadInt32();
            if (count != LayerCount * RecordsPerLayer)
                throw new InvalidDataException("Unexpected backup record count");

            List<byte[]> profile = new List<byte[]>(count);
            for (int i = 0; i < count; i++)
            {
                byte[] record = reader.ReadBytes(ReportLength);
                if (record.Length != ReportLength)
                    throw new EndOfStreamException("Backup is truncated");
                profile.Add(record);
            }
            return profile;
        }
    }

    private static void PrintProfile(List<byte[]> profile)
    {
        foreach (byte[] record in profile)
        {
            Console.WriteLine(
                "L{0} K{1:X2}: {2}",
                record[3],
                record[2],
                BitConverter.ToString(record, 0, 50).Replace('-', ' '));
        }
    }

    private static void PrintUsage()
    {
        Console.Error.WriteLine("MiniKeyboardProfile.exe read");
        Console.Error.WriteLine("MiniKeyboardProfile.exe configure <backup-file>");
        Console.Error.WriteLine("MiniKeyboardProfile.exe restore <backup-file>");
    }
}
