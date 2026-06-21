using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Text;
using System.Text.Json;

const uint ProcessQueryInformation = 0x0400;
const uint ProcessVmRead = 0x0010;
const uint MemCommit = 0x1000;
const uint PageGuard = 0x100;
const uint PageNoAccess = 0x01;
if (args.Length != 2)
{
    Console.Error.WriteLine("Usage: cm4-extract <database-directory> <output-json>");
    return 1;
}

var databaseDirectory = Path.GetFullPath(args[0]);
var outputPath = Path.GetFullPath(args[1]);
var nestedDatabaseDirectory = Path.Combine(databaseDirectory, "db");
var dataDirectory = File.Exists(Path.Combine(nestedDatabaseDirectory, "server_db.dat"))
    ? nestedDatabaseDirectory
    : databaseDirectory;
var serverPath = Path.Combine(dataDirectory, "server_db.dat");
var clientPath = Path.Combine(dataDirectory, "client_db.dat");
var isOriginalCm4 = !File.Exists(clientPath);

if (isOriginalCm4)
{
    Console.Error.WriteLine(
        "Original CM4 databases require direct people_db.dat decoding. " +
        "Runtime extraction is intentionally disabled because a loaded game contains only its selected subset.");
    return 1;
}

var runtimeLayout = isOriginalCm4
    ? Cm4RuntimeLayout.OriginalCm4
    : Cm4RuntimeLayout.Cm0304Editor;

if (!File.Exists(serverPath))
{
    Console.Error.WriteLine("The database directory must contain server_db.dat, either directly or inside db.");
    return 1;
}

var editorProcesses = Process.GetProcessesByName(runtimeLayout.ProcessName);

if (editorProcesses.Length != 1)
{
    Console.Error.WriteLine(runtimeLayout.ProcessInstruction);
    return 1;
}

var process = editorProcesses[0];
var processHandle = OpenProcess(ProcessQueryInformation | ProcessVmRead, false, process.Id);

if (processHandle == IntPtr.Zero)
{
    throw new Win32Exception(Marshal.GetLastWin32Error());
}

try
{
    Console.WriteLine("Reading database string tables...");
    var personNames = ReadPersonNames(serverPath);
    var hasClientDatabase = File.Exists(clientPath);
    var metadataBuffer = File.ReadAllBytes(hasClientDatabase ? clientPath : serverPath);
    var leagueMembership = ReadLeagueMembership(databaseDirectory);
    var namedObjects = hasClientDatabase
        ? ReadNamedObjects(metadataBuffer, leagueMembership)
        : ReadRootNamedObjects(metadataBuffer, leagueMembership);
    Console.WriteLine(
        $"Found {personNames.Count:N0} person names, " +
        $"{namedObjects.Clubs.Count:N0} clubs, " +
        $"{namedObjects.Leagues.Count:N0} leagues, and {namedObjects.Nations.Count:N0} nations.");

    Console.WriteLine("Scanning loaded editor people...");
    DebugPersonNameReferences(processHandle, personNames, runtimeLayout);
    var people = ReadPeople(processHandle, personNames, namedObjects, runtimeLayout);

    if (people.Length < 1_000)
    {
        Console.Error.WriteLine(
            $"Only {people.Length:N0} matching people were found. " +
            "The open CM Data Editor does not appear to have this database loaded.");
        return 1;
    }

    var clubs = namedObjects.Clubs.Values
        .OrderBy(record => record.Name)
        .ToArray();
    var leagues = namedObjects.Leagues.Values
        .OrderBy(record => record.Name)
        .ToArray();
    var nations = people
        .Where(person => person.NationId is not null && !string.IsNullOrWhiteSpace(person.Nation))
        .GroupBy(person => person.NationId!.Value)
        .Select(group => new NamedRecord(group.Key, group.First().Nation))
        .OrderBy(record => record.Name)
        .ToArray();
    Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
    using var output = File.Create(outputPath);
    WriteDatabase(output, people, clubs, leagues, nations);

    Console.WriteLine($"Wrote {people.Length:N0} people to {outputPath}");
}
finally
{
    CloseHandle(processHandle);
}

return 0;

static void DebugPersonNameReferences(
    IntPtr processHandle,
    IReadOnlyDictionary<(uint Id, uint Reference), string> personNames,
    Cm4RuntimeLayout runtimeLayout)
{
    var debugName = Environment.GetEnvironmentVariable("CM4_DEBUG_NAME_PART");

    if (string.IsNullOrWhiteSpace(debugName))
    {
        return;
    }

    var nameAddresses = new HashSet<uint>();
    long address = 0;
    var memoryInfoSize = (nuint)Marshal.SizeOf<MemoryBasicInformation>();

    while (address < 0x7fff0000 &&
           VirtualQueryEx(processHandle, (IntPtr)address, out var memoryInfo, memoryInfoSize) != 0)
    {
        var regionSize = checked((long)memoryInfo.RegionSize);
        var readable = memoryInfo.State == MemCommit &&
                       (memoryInfo.Protect & PageGuard) == 0 &&
                       (memoryInfo.Protect & PageNoAccess) == 0 &&
                       regionSize is > 0 and <= 256 * 1024 * 1024;

        if (readable)
        {
            var region = ReadMemory(processHandle, memoryInfo.BaseAddress.ToInt64(), checked((int)regionSize));

            if (region is not null)
            {
                for (var offset = 0; offset + 12 <= region.Length; offset += 4)
                {
                    if (BitConverter.ToUInt32(region, offset) != runtimeLayout.PersonNameVtable)
                    {
                        continue;
                    }

                    var reference = BitConverter.ToUInt32(region, offset + 4);
                    var nextId = BitConverter.ToUInt32(region, offset + 8);

                    if (personNames.TryGetValue((nextId, reference), out var value) &&
                        value.Equals(debugName, StringComparison.OrdinalIgnoreCase))
                    {
                        var nameAddress = checked((uint)(memoryInfo.BaseAddress.ToInt64() + offset));
                        nameAddresses.Add(nameAddress);
                        Console.WriteLine($"DEBUG NAME '{value}' address=0x{nameAddress:x8}");
                    }
                }
            }
        }

        address = memoryInfo.BaseAddress.ToInt64() + Math.Max(regionSize, 0x1000);
    }

    if (nameAddresses.Count == 0)
    {
        return;
    }

    address = 0;

    while (address < 0x7fff0000 &&
           VirtualQueryEx(processHandle, (IntPtr)address, out var memoryInfo, memoryInfoSize) != 0)
    {
        var regionSize = checked((long)memoryInfo.RegionSize);
        var readable = memoryInfo.State == MemCommit &&
                       (memoryInfo.Protect & PageGuard) == 0 &&
                       (memoryInfo.Protect & PageNoAccess) == 0 &&
                       regionSize is > 0 and <= 256 * 1024 * 1024;

        if (readable)
        {
            var region = ReadMemory(processHandle, memoryInfo.BaseAddress.ToInt64(), checked((int)regionSize));

            if (region is not null)
            {
                for (var offset = 0; offset + 4 <= region.Length; offset += 4)
                {
                    var value = BitConverter.ToUInt32(region, offset);

                    if (!nameAddresses.Contains(value))
                    {
                        continue;
                    }

                    var hitAddress = memoryInfo.BaseAddress.ToInt64() + offset;
                    var dumpAddress = Math.Max(0, hitAddress - 320);
                    var dump = ReadMemory(processHandle, dumpAddress, 512);
                    Console.WriteLine(
                        $"DEBUG NAME REF at=0x{hitAddress:x8} relDump=320 bytes=" +
                        (dump is null ? "" : Convert.ToHexString(dump)));

                    if (dump is not null)
                    {
                        for (var relativeOffset = -320; relativeOffset <= 64; relativeOffset += 4)
                        {
                            var dumpOffset = relativeOffset + 320;
                            var pointer = BitConverter.ToUInt32(dump, dumpOffset);
                            var target = pointer == 0 ? null : ReadMemory(processHandle, pointer, 96);
                            var vtable = target is null ? 0 : BitConverter.ToUInt32(target, 0);

                            Console.WriteLine(
                                $"DEBUG REF rel={relativeOffset,4} value=0x{pointer:x8} " +
                                $"vtable=0x{vtable:x8} bytes=" +
                                (target is null ? "" : Convert.ToHexString(target.AsSpan(0, 48))));
                        }
                    }
                }
            }
        }

        address = memoryInfo.BaseAddress.ToInt64() + Math.Max(regionSize, 0x1000);
    }
}

static Dictionary<(uint Id, uint Reference), string> ReadPersonNames(string filePath)
{
    var buffer = File.ReadAllBytes(filePath);
    var recordsByGroup = new Dictionary<uint, SortedDictionary<uint, (uint Reference, string Value)>>();

    for (var offset = 0; offset + 23 < buffer.Length; offset++)
    {
        if (buffer[offset] != 0)
        {
            continue;
        }

        var group = BitConverter.ToUInt32(buffer, offset + 3);
        var id = BitConverter.ToUInt32(buffer, offset + 7);
        var reference = BitConverter.ToUInt32(buffer, offset + 11);
        var length = BitConverter.ToUInt32(buffer, offset + 16);

        if (length is < 1 or > 80 ||
            offset + 20 + length * 2 + 2 > buffer.Length)
        {
            continue;
        }

        var value = Encoding.Unicode
            .GetString(buffer, offset + 20, checked((int)length * 2))
            .TrimEnd('\0')
            .Trim();

        if (value.Length > 0 && !value.Any(char.IsControl))
        {
            if (!recordsByGroup.TryGetValue(group, out var records))
            {
                records = new SortedDictionary<uint, (uint Reference, string Value)>();
                recordsByGroup[group] = records;
            }

            records[id] = (reference, value);
        }
    }

    var names = new Dictionary<(uint Id, uint Reference), string>();

    foreach (var records in recordsByGroup.Values)
    {
        foreach (var (id, record) in records)
        {
            if (id > 0 && records.TryGetValue(id - 1, out var previous))
            {
                names.TryAdd((id, record.Reference), previous.Value);
            }
        }
    }

    return names;
}

static LeagueMembership ReadLeagueMembership(string databaseDirectory)
{
    var leagues = new Dictionary<int, NamedRecord>();
    var clubLeaguesByName = new Dictionary<string, NamedRecord>(StringComparer.OrdinalIgnoreCase);
    var compsDirectory = Path.Combine(databaseDirectory, "comps");

    foreach (var filePath in Directory.Exists(compsDirectory)
        ? Directory.EnumerateFiles(compsDirectory, "*.cmp")
        : [])
    {
        var fileName = Path.GetFileNameWithoutExtension(filePath);
        var match = Regex.Match(fileName, @"^(?<code>.+)_(?<id>\d+)$", RegexOptions.IgnoreCase);

        if (!match.Success ||
            !int.TryParse(match.Groups["id"].Value, out var leagueId))
        {
            continue;
        }

        var leagueName = Cm4Schema.LeagueNames.TryGetValue(match.Groups["code"].Value.ToLowerInvariant(), out var knownName)
            ? knownName
            : match.Groups["code"].Value.Replace('_', ' ');
        var league = new NamedRecord(leagueId, leagueName);
        leagues.TryAdd(leagueId, league);

        var text = Encoding.Latin1.GetString(File.ReadAllBytes(filePath));

        foreach (Match clubMatch in Regex.Matches(text, "\"([^\"]+)\""))
        {
            var clubName = clubMatch.Groups[1].Value.Trim();

            if (clubName.Length == 0 ||
                clubName.Equals("LEAGUE_STAGE", StringComparison.OrdinalIgnoreCase) ||
                clubName.Equals("FIXTURES", StringComparison.OrdinalIgnoreCase) ||
                clubName.Equals("VERSION", StringComparison.OrdinalIgnoreCase) ||
                clubName.Equals("Bye", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            clubLeaguesByName.TryAdd(clubName, league);
        }
    }

    ReadModernLeagueFallbacks(databaseDirectory, leagues, clubLeaguesByName);
    return new LeagueMembership(leagues, clubLeaguesByName);
}

static void ReadModernLeagueFallbacks(
    string databaseDirectory,
    IDictionary<int, NamedRecord> leagues,
    IDictionary<string, NamedRecord> clubLeaguesByName)
{
    var parentDirectory = Directory.GetParent(databaseDirectory)?.FullName;

    if (parentDirectory is null)
    {
        return;
    }

    var fallbackDirectory = Path.Combine(parentDirectory, "01-02 dat");
    var clubsPath = Path.Combine(fallbackDirectory, "club.dat");
    var leaguesPath = Path.Combine(fallbackDirectory, "club_comp.dat");

    if (!File.Exists(clubsPath) || !File.Exists(leaguesPath))
    {
        return;
    }

    const int leagueRecordSize = 107;
    const int clubRecordSize = 581;
    var leagueBuffer = File.ReadAllBytes(leaguesPath);
    var clubBuffer = File.ReadAllBytes(clubsPath);
    var leagueNamesById = new Dictionary<int, string>();

    for (var offset = 0; offset + leagueRecordSize <= leagueBuffer.Length; offset += leagueRecordSize)
    {
        var id = BitConverter.ToInt32(leagueBuffer, offset);
        var name = ReadLatin1(leagueBuffer, offset + 4, 51);

        if (id >= 0 && name.Length > 0)
        {
            leagueNamesById[id] = name;
        }
    }

    var fallbackLeaguesByName = new Dictionary<string, NamedRecord>(StringComparer.OrdinalIgnoreCase);
    var nextLeagueId = Math.Max(100_000, leagues.Keys.DefaultIfEmpty(0).Max() + 1);

    for (var offset = 0; offset + clubRecordSize <= clubBuffer.Length; offset += clubRecordSize)
    {
        var leagueId = BitConverter.ToInt32(clubBuffer, offset + 87);

        if (!leagueNamesById.TryGetValue(leagueId, out var leagueName))
        {
            continue;
        }

        if (!fallbackLeaguesByName.TryGetValue(leagueName, out var league))
        {
            league = new NamedRecord(nextLeagueId++, leagueName);
            fallbackLeaguesByName[leagueName] = league;
            leagues.TryAdd(league.Id, league);
        }

        var clubName = ReadLatin1(clubBuffer, offset + 4, 51);
        var shortName = ReadLatin1(clubBuffer, offset + 56, 25);

        if (clubName.Length > 0)
        {
            clubLeaguesByName.TryAdd(clubName, league);
        }
        if (shortName.Length > 0)
        {
            clubLeaguesByName.TryAdd(shortName, league);
        }
    }
}

static string ReadLatin1(byte[] buffer, int offset, int length)
{
    return Encoding.Latin1
        .GetString(buffer, offset, length)
        .Replace("\xff", "")
        .Split('\0')[0]
        .Trim();
}

static NamedObjectMaps ReadNamedObjects(byte[] buffer, LeagueMembership leagueMembership)
{
    var clubs = new Dictionary<uint, ClubRecord>();
    var nations = new Dictionary<uint, string>();

    for (var textOffset = 32; textOffset + 8 < buffer.Length; textOffset++)
    {
        if (buffer[textOffset - 6] != 0x0d || buffer[textOffset - 5] != 0x0d)
        {
            continue;
        }

        var length = BitConverter.ToUInt32(buffer, textOffset - 4);

        if (length is < 1 or > 100 ||
            textOffset + length * 2 + 2 > buffer.Length)
        {
            continue;
        }

        var name = ReadUnicode(buffer, textOffset, checked((int)length));

        if (name.Length == 0)
        {
            continue;
        }

        if (textOffset < 2_100_000)
        {
            var clubObjectId = ReadClubObjectId(buffer, textOffset);

            if (clubObjectId is > 0 and < 20_000_000)
            {
                leagueMembership.ClubLeaguesByName.TryGetValue(name, out var league);
                clubs[clubObjectId] = new ClubRecord(
                    (int)clubObjectId,
                    name,
                    league?.Id,
                    league?.Name ?? "");
            }
        }

        if (textOffset is < 2_100_000 or > 2_150_000)
        {
            continue;
        }

        var shortLengthOffset = textOffset + checked((int)length * 2) + 2;

        if (shortLengthOffset + 4 > buffer.Length)
        {
            continue;
        }

        var shortLength = BitConverter.ToUInt32(buffer, shortLengthOffset);

        if (shortLength > 100)
        {
            continue;
        }

        var metadataStart = shortLengthOffset + 4 + checked((int)shortLength * 2) + 2;

        foreach (var relativeOffset in new[] { 7, 13, 19 })
        {
            var offset = metadataStart + relativeOffset;

            if (offset + 8 > buffer.Length)
            {
                continue;
            }

            var databaseId = BitConverter.ToUInt32(buffer, offset);
            var nationObjectId = BitConverter.ToUInt32(buffer, offset + 4);

            if (databaseId < 1_000 &&
                nationObjectId is > 0 and < 5_000 &&
                nationObjectId > databaseId &&
                nationObjectId - databaseId <= 2_000)
            {
                nations[nationObjectId] = name;
                break;
            }
        }
    }

    return new NamedObjectMaps(clubs, leagueMembership.Leagues, nations);
}

static NamedObjectMaps ReadRootNamedObjects(
    byte[] buffer,
    LeagueMembership leagueMembership)
{
    var clubs = new Dictionary<uint, ClubRecord>();
    var nations = new Dictionary<uint, string>();

    for (var markerOffset = 9; markerOffset + 12 < buffer.Length; markerOffset++)
    {
        if (BitConverter.ToUInt32(buffer, markerOffset) != 139)
        {
            continue;
        }

        var clubId = BitConverter.ToUInt32(buffer, markerOffset - 5);

        if (clubId is < 1 or > 20_000_000)
        {
            continue;
        }

        var strings = ReadLengthPrefixedStrings(
            buffer,
            markerOffset + 5,
            Math.Min(buffer.Length, markerOffset + 280));

        if (strings.Count < 2)
        {
            continue;
        }

        var displayNames = strings
            .Skip(1)
            .Where(value => value.Length > 1)
            .ToArray();

        if (displayNames.Length == 0)
        {
            continue;
        }

        var name = displayNames
            .OrderByDescending(value => value.Length)
            .First();
        leagueMembership.ClubLeaguesByName.TryGetValue(name, out var league);
        clubs.TryAdd(
            clubId,
            new ClubRecord(
                (int)clubId,
                name,
                league?.Id,
                league?.Name ?? ""));
    }

    for (var textOffset = 2_000_000; textOffset + 16 < buffer.Length; textOffset++)
    {
        var length = BitConverter.ToUInt32(buffer, textOffset);

        if (length is < 2 or > 60)
        {
            continue;
        }

        var firstTextOffset = textOffset + 4;
        var secondLengthOffset = firstTextOffset + checked((int)length * 2) + 2;

        if (secondLengthOffset + 4 > buffer.Length ||
            BitConverter.ToUInt32(buffer, secondLengthOffset) != length)
        {
            continue;
        }

        var secondTextOffset = secondLengthOffset + 4;

        if (secondTextOffset + length * 2 + 2 > buffer.Length)
        {
            continue;
        }

        var name = ReadUnicode(buffer, firstTextOffset, checked((int)length));
        var repeatedName = ReadUnicode(buffer, secondTextOffset, checked((int)length));

        if (name.Length == 0 ||
            !name.Equals(repeatedName, StringComparison.Ordinal))
        {
            continue;
        }

        var metadataStart = secondTextOffset + checked((int)length * 2) + 2;
        var metadataEnd = Math.Min(buffer.Length - 8, metadataStart + 96);

        for (var offset = metadataStart; offset <= metadataEnd; offset++)
        {
            var databaseId = BitConverter.ToUInt32(buffer, offset);
            var nationObjectId = BitConverter.ToUInt32(buffer, offset + 4);

            if (databaseId < 1_000 &&
                nationObjectId is > 0 and < 5_000 &&
                nationObjectId > databaseId &&
                nationObjectId - databaseId <= 2_000)
            {
                nations.TryAdd(nationObjectId, name);
                break;
            }
        }

        textOffset = secondTextOffset + checked((int)length * 2);
    }

    return new NamedObjectMaps(clubs, leagueMembership.Leagues, nations);
}

static List<string> ReadLengthPrefixedStrings(
    byte[] buffer,
    int start,
    int end)
{
    var strings = new List<string>();

    for (var offset = start; offset + 6 <= end; offset++)
    {
        var length = BitConverter.ToUInt32(buffer, offset);

        if (length is < 2 or > 60 ||
            offset + 4 + length * 2 + 2 > end)
        {
            continue;
        }

        var value = ReadUnicode(buffer, offset + 4, checked((int)length));

        if (value.Length != length ||
            value.Any(character => char.IsControl(character)))
        {
            continue;
        }

        strings.Add(value);
        offset += 3 + checked((int)length * 2) + 2;
    }

    return strings;
}

static uint ReadClubObjectId(byte[] buffer, int textOffset)
{
    var scanStart = Math.Max(0, textOffset - 256);

    for (var offset = textOffset - 8; offset >= scanStart; offset--)
    {
        if (offset + 14 > buffer.Length)
        {
            continue;
        }

        var locationId = BitConverter.ToUInt32(buffer, offset);
        var clubId = BitConverter.ToUInt32(buffer, offset + 4);
        var hasClubHeader =
            locationId is > 0 and < 5_000 &&
            clubId is > 100 and < 20_000_000 &&
            buffer[offset + 8] == 0 &&
            buffer[offset + 10] == 0 &&
            buffer[offset + 11] == 0 &&
            buffer[offset + 12] == 0 &&
            buffer[offset + 13] == 0x0d;

        if (hasClubHeader)
        {
            return clubId;
        }
    }

    foreach (var relativeOffset in new[] { -28, -38 })
    {
        var offset = textOffset + relativeOffset;

        if (offset < 0 || offset + 4 > buffer.Length)
        {
            continue;
        }

        var clubId = BitConverter.ToUInt32(buffer, offset);

        if (clubId is > 100 and < 20_000_000)
        {
            return clubId;
        }
    }

    return 0;
}

static string ReadUnicode(byte[] buffer, int offset, int length)
{
    return Encoding.Unicode
        .GetString(buffer, offset, length * 2)
        .TrimEnd('\0')
        .Trim();
}

static Cm4Person[] ReadPeople(
    IntPtr processHandle,
    IReadOnlyDictionary<(uint Id, uint Reference), string> personNames,
    NamedObjectMaps namedObjects,
    Cm4RuntimeLayout runtimeLayout)
{
    var people = new Dictionary<int, Cm4Person>();
    long address = 0;
    var memoryInfoSize = (nuint)Marshal.SizeOf<MemoryBasicInformation>();

    while (address < 0x7fff0000 &&
           VirtualQueryEx(processHandle, (IntPtr)address, out var memoryInfo, memoryInfoSize) != 0)
    {
        var regionSize = checked((long)memoryInfo.RegionSize);
        var readable = memoryInfo.State == MemCommit &&
                       (memoryInfo.Protect & PageGuard) == 0 &&
                       (memoryInfo.Protect & PageNoAccess) == 0 &&
                       regionSize is > 0 and <= 256 * 1024 * 1024;

        if (readable)
        {
            var region = new byte[regionSize];

            if (ReadProcessMemory(processHandle, memoryInfo.BaseAddress, region, region.Length, out var bytesRead) &&
                bytesRead.ToInt64() > 0)
            {
                var length = checked((int)bytesRead);

                for (var offset = 0; offset + 4 <= length; offset += 4)
                {
                    var vtable = BitConverter.ToUInt32(region, offset);

                    if (vtable != runtimeLayout.PersonVtable &&
                        vtable != runtimeLayout.NonPlayingPersonVtable)
                    {
                        continue;
                    }

                    var personAddress = memoryInfo.BaseAddress.ToInt64() + offset;
                    var person = ReadPerson(
                        processHandle,
                        personAddress,
                        vtable == runtimeLayout.NonPlayingPersonVtable,
                        personNames,
                        namedObjects,
                        runtimeLayout);

                    if (person is not null)
                    {
                        if (people.TryGetValue(person.Id, out var existing))
                        {
                            people[person.Id] = MergePeople(existing, person);
                        }
                        else
                        {
                            people.Add(person.Id, person);
                        }
                    }
                }
            }
        }

        address = memoryInfo.BaseAddress.ToInt64() + Math.Max(regionSize, 0x1000);
    }

    return people.Values
        .OrderBy(person => person.DisplayName, StringComparer.OrdinalIgnoreCase)
        .ThenBy(person => person.Id)
        .ToArray();
}

static Cm4Person MergePeople(Cm4Person existing, Cm4Person candidate)
{
    var preferred = existing.ClubId is null && candidate.ClubId is not null
        ? candidate
        : existing;
    var fallback = ReferenceEquals(preferred, existing) ? candidate : existing;

    return preferred with
    {
        ClubId = preferred.ClubId ?? fallback.ClubId,
        Club = preferred.Club.Length > 0 ? preferred.Club : fallback.Club,
        PlayerRatings = preferred.PlayerRatings ?? fallback.PlayerRatings,
        NonPlayingRatings = preferred.NonPlayingRatings ?? fallback.NonPlayingRatings,
        JobCode = preferred.JobCode ?? fallback.JobCode
    };
}

static Rating[] ReadMentalAttributes(
    IntPtr processHandle,
    byte[] personBuffer,
    int personOffset,
    int personDataPointerOffset,
    Cm4RuntimeLayout runtimeLayout)
{
    var personDataAddress = BitConverter.ToUInt32(personBuffer, personOffset + personDataPointerOffset);
    var buffer = ReadMemory(processHandle, personDataAddress, 140);

    const int currentMentalRecordOffset = 20;
    const int attributeOffset = currentMentalRecordOffset + 12;

    if (buffer is null ||
        BitConverter.ToUInt32(buffer, currentMentalRecordOffset) != runtimeLayout.PersonDataVtable)
    {
        return [];
    }

    var sourceIndexes = new[] { 0, 1, 7, 2, 3, 4, 5, 6 };
    return Cm4Schema.MentalAttributeLabels
        .Select((label, index) => new Rating(label, buffer[attributeOffset + sourceIndexes[index]]))
        .ToArray();
}

static Cm4Person? ReadPerson(
    IntPtr processHandle,
    long personAddress,
    bool isNonPlaying,
    IReadOnlyDictionary<(uint Id, uint Reference), string> personNames,
    NamedObjectMaps namedObjects,
    Cm4RuntimeLayout runtimeLayout)
{
    var personBuffer = ReadMemory(processHandle, personAddress - 284, 352);

    if (personBuffer is null)
    {
        return null;
    }

    const int personOffset = 284;
    var id = BitConverter.ToInt32(personBuffer, personOffset + 4);
    var playerPrefixAdjustment = isNonPlaying ? 0 : runtimeLayout.PlayerPrefixAdjustment;
    var detailAddress = BitConverter.ToUInt32(
        personBuffer,
        personOffset + (isNonPlaying ? -8 : -20 + playerPrefixAdjustment));
    var firstNameAddress = BitConverter.ToUInt32(personBuffer, personOffset + 32);
    var secondNameAddress = BitConverter.ToUInt32(personBuffer, personOffset + 36);
    var commonNameAddress = BitConverter.ToUInt32(personBuffer, personOffset + 40);

    if (id < 0 ||
        firstNameAddress == 0 ||
        secondNameAddress == 0)
    {
        return null;
    }

    var firstName = ReadPersonName(processHandle, firstNameAddress, personNames, runtimeLayout);
    var secondName = ReadPersonName(processHandle, secondNameAddress, personNames, runtimeLayout);
    var commonName = commonNameAddress == 0
        ? ""
        : ReadPersonName(processHandle, commonNameAddress, personNames, runtimeLayout);
    var displayName = commonName.Length > 0
        ? commonName
        : string.Join(" ", new[] { firstName, secondName }.Where(value => value.Length > 0));

    if (displayName.Length == 0 || displayName.Any(char.IsControl))
    {
        return null;
    }

    if (displayName.Equals(Environment.GetEnvironmentVariable("CM4_DEBUG_PERSON_NAME"), StringComparison.OrdinalIgnoreCase))
    {
        Console.WriteLine($"DEBUG PERSON id={id} address=0x{personAddress:x} name='{displayName}'");

        for (var relativeOffset = -284; relativeOffset <= 64; relativeOffset += 4)
        {
            var offset = personOffset + relativeOffset;
            var value = BitConverter.ToUInt32(personBuffer, offset);
            var target = value == 0 ? null : ReadMemory(processHandle, value, 128);
            var vtable = target is null ? 0 : BitConverter.ToUInt32(target, 0);
            Console.WriteLine(
                $"DEBUG rel={relativeOffset,4} value=0x{value:x8} vtable=0x{vtable:x8} " +
                $"bytes={(target is null ? "" : Convert.ToHexString(target.AsSpan(0, 80)))}");
        }

    }

    var detailBuffer = ReadMemory(
        processHandle,
        detailAddress,
        isNonPlaying ? 64 : 12 + runtimeLayout.PlayerAttributeCount);
    var expectedDetailVtable = isNonPlaying
        ? runtimeLayout.NonPlayingDataVtable
        : runtimeLayout.PlayingDataVtable;

    if (detailBuffer is null ||
        BitConverter.ToUInt32(detailBuffer, 0) != expectedDetailVtable)
    {
        return null;
    }

    var clubId = ReadCurrentClubId(
        processHandle,
        personBuffer,
        personOffset,
        isNonPlaying ? -104 : -212 + playerPrefixAdjustment,
        namedObjects);
    var nationId = ReadObjectId(processHandle, BitConverter.ToUInt32(personBuffer, personOffset + 56));
    var packedDate = BitConverter.ToUInt32(personBuffer, personOffset + 48);
    var dayOfYear = (int)(packedDate & 0xffff);
    var year = (int)(packedDate >> 16);

    var mentalAttributes = ReadMentalAttributes(
        processHandle,
        personBuffer,
        personOffset,
        isNonPlaying ? -108 : -216 + playerPrefixAdjustment,
        runtimeLayout);
    Cm4Ratings? playerRatings = null;
    Cm4NonPlayingRatings? nonPlayingRatings = null;
    byte? jobCode = null;

    if (isNonPlaying)
    {
        var attributes = detailBuffer.AsSpan(12, Cm4Schema.NonPlayingAttributeLabels.Length).ToArray();
        nonPlayingRatings = new Cm4NonPlayingRatings(
            BitConverter.ToUInt16(personBuffer, personOffset - 42),
            BitConverter.ToUInt16(personBuffer, personOffset - 40),
            BitConverter.ToUInt16(personBuffer, personOffset - 48),
            BitConverter.ToUInt16(personBuffer, personOffset - 46),
            BitConverter.ToUInt16(personBuffer, personOffset - 44),
            Cm4Schema.NonPlayingAttributeLabels
                .Select((label, index) => new Rating(label, attributes[index]))
                .ToArray(),
            mentalAttributes);
        jobCode = personBuffer[personOffset - 38];
    }
    else
    {
        var attributes = detailBuffer.AsSpan(12, runtimeLayout.PlayerAttributeCount).ToArray();
        playerRatings = new Cm4Ratings(
            0,
            BitConverter.ToUInt16(personBuffer, personOffset - 144 + playerPrefixAdjustment),
            BitConverter.ToUInt16(personBuffer, personOffset - 142 + playerPrefixAdjustment),
            BitConverter.ToUInt16(personBuffer, personOffset - 150 + playerPrefixAdjustment),
            BitConverter.ToUInt16(personBuffer, personOffset - 148 + playerPrefixAdjustment),
            BitConverter.ToUInt16(personBuffer, personOffset - 146 + playerPrefixAdjustment),
            Cm4Schema.PositionLabels.Select((label, index) => new Rating(label, attributes[index])).ToArray(),
            Cm4Schema.SideIndexes.Select(item => new Rating(item.Label, attributes[item.Index])).ToArray(),
            runtimeLayout.AttributeIndexes.Select(item => new Rating(item.Label, attributes[item.Index])).ToArray(),
            mentalAttributes);
    }

    return new Cm4Person(
        id,
        firstName,
        secondName,
        commonName,
        displayName,
        ToBirthDate(dayOfYear, year),
        BitConverter.ToUInt16(personBuffer, personOffset + 60),
        BitConverter.ToUInt16(personBuffer, personOffset + 62),
        nationId,
        nationId is not null && namedObjects.Nations.TryGetValue((uint)nationId.Value, out var nationName) ? nationName : "",
        clubId,
        clubId is not null && namedObjects.Clubs.TryGetValue((uint)clubId.Value, out var club) ? club.Name : "",
        jobCode,
        playerRatings,
        nonPlayingRatings
    );
}

static int? ReadCurrentClubId(
    IntPtr processHandle,
    byte[] personBuffer,
    int personOffset,
    int contractListPointerOffset,
    NamedObjectMaps namedObjects)
{
    var contractListAddress = BitConverter.ToUInt32(
        personBuffer,
        personOffset + contractListPointerOffset);
    var buffer = ReadMemory(processHandle, contractListAddress, 392);

    if (buffer is null)
    {
        return null;
    }

    var clubIds = new List<int>();

    foreach (var offset in new[] { 244, 388 })
    {
        if (offset + 4 > buffer.Length)
        {
            continue;
        }

        var clubId = ReadObjectId(processHandle, BitConverter.ToUInt32(buffer, offset));

        if (clubId is null ||
            !namedObjects.Clubs.ContainsKey((uint)clubId.Value))
        {
            continue;
        }

        clubIds.Add(clubId.Value);
    }

    if (clubIds.Distinct().Take(2).Count() == 1)
    {
        return clubIds[0];
    }

    return null;
}

static string ReadPersonName(
    IntPtr processHandle,
    uint address,
    IReadOnlyDictionary<(uint Id, uint Reference), string> personNames,
    Cm4RuntimeLayout runtimeLayout)
{
    var buffer = ReadMemory(processHandle, address, 12);

    if (buffer is null ||
        BitConverter.ToUInt32(buffer, 0) != runtimeLayout.PersonNameVtable)
    {
        return "";
    }

    var reference = BitConverter.ToUInt32(buffer, 4);
    var nextId = BitConverter.ToUInt32(buffer, 8);
    return personNames.TryGetValue((nextId, reference), out var value)
        ? value
        : "";
}

static int? ReadObjectId(IntPtr processHandle, uint address)
{
    if (address == 0)
    {
        return null;
    }

    var buffer = ReadMemory(processHandle, address, 8);

    if (buffer is null)
    {
        return null;
    }

    var id = BitConverter.ToInt32(buffer, 4);
    return id > 0 ? id : null;
}

static byte[]? ReadMemory(IntPtr processHandle, long address, int length)
{
    var buffer = new byte[length];
    return ReadProcessMemory(processHandle, (IntPtr)address, buffer, buffer.Length, out var bytesRead) &&
           bytesRead.ToInt64() == length
        ? buffer
        : null;
}

static BirthDate? ToBirthDate(int dayOfYear, int year)
{
    if (year is < 1800 or > 2100 || dayOfYear is < 0 or > 365)
    {
        return null;
    }

    var date = new DateTime(year, 1, 1).AddDays(dayOfYear);
    var monthLengths = new[] { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    var normalizedDayOfYear = monthLengths.Take(date.Month - 1).Sum() + date.Day - 1;
    return new BirthDate(date.Day, date.Month, date.Year, normalizedDayOfYear);
}

static void WriteDatabase(
    Stream output,
    IReadOnlyCollection<Cm4Person> people,
    IReadOnlyCollection<ClubRecord> clubs,
    IReadOnlyCollection<NamedRecord> leagues,
    IReadOnlyCollection<NamedRecord> nations)
{
    using var writer = new Utf8JsonWriter(output);
    writer.WriteStartObject();
    writer.WriteNumber("version", 4);
    writer.WritePropertyName("staff");
    writer.WriteStartArray();

    foreach (var person in people)
    {
        writer.WriteStartArray();
        writer.WriteNumberValue(person.Id);
        writer.WriteStringValue(person.FirstName);
        writer.WriteStringValue(person.SecondName);
        writer.WriteStringValue(person.CommonName);
        writer.WriteStringValue(person.DisplayName);
        writer.WriteNumberValue(person.BirthDate?.DayOfYear ?? -1);
        writer.WriteNumberValue(person.BirthDate?.Year ?? 0);
        writer.WriteNumberValue(person.InternationalApps);
        writer.WriteNumberValue(person.InternationalGoals);
        writer.WriteNumberValue(person.NationId ?? 0);
        writer.WriteNumberValue(person.ClubId ?? 0);
        writer.WriteNumberValue(
            (person.PlayerRatings is null ? 0 : 1) |
            (person.NonPlayingRatings is null ? 0 : 2));
        writer.WriteNumberValue(person.JobCode ?? -1);
        WritePlayerRatings(writer, person.PlayerRatings);
        WriteNonPlayingRatings(writer, person.NonPlayingRatings);

        writer.WriteEndArray();
    }

    writer.WriteEndArray();
    WriteClubRecords(writer, "clubs", clubs);
    WriteNamedRecords(writer, "leagues", leagues);
    WriteNamedRecords(writer, "nations", nations);
    writer.WriteEndObject();
}

static void WritePlayerRatings(Utf8JsonWriter writer, Cm4Ratings? ratings)
{
    if (ratings is null)
    {
        writer.WriteNullValue();
        return;
    }

    writer.WriteStartArray();
    writer.WriteNumberValue(ratings.CurrentAbility);
    writer.WriteNumberValue(ratings.PotentialAbility);
    writer.WriteNumberValue(ratings.HomeReputation);
    writer.WriteNumberValue(ratings.CurrentReputation);
    writer.WriteNumberValue(ratings.WorldReputation);

    foreach (var rating in ratings.Positions
        .Concat(ratings.Sides)
        .Concat(ratings.Attributes)
        .Concat(ratings.MentalAttributes))
    {
        writer.WriteNumberValue(rating.Value);
    }

    writer.WriteEndArray();
}

static void WriteNonPlayingRatings(Utf8JsonWriter writer, Cm4NonPlayingRatings? ratings)
{
    if (ratings is null)
    {
        writer.WriteNullValue();
        return;
    }

    writer.WriteStartArray();
    writer.WriteNumberValue(ratings.CurrentAbility);
    writer.WriteNumberValue(ratings.PotentialAbility);
    writer.WriteNumberValue(ratings.HomeReputation);
    writer.WriteNumberValue(ratings.CurrentReputation);
    writer.WriteNumberValue(ratings.WorldReputation);

    foreach (var rating in ratings.Attributes.Concat(ratings.MentalAttributes))
    {
        writer.WriteNumberValue(rating.Value);
    }

    writer.WriteEndArray();
}

static void WriteClubRecords(
    Utf8JsonWriter writer,
    string propertyName,
    IEnumerable<ClubRecord> records)
{
    writer.WritePropertyName(propertyName);
    writer.WriteStartArray();

    foreach (var record in records)
    {
        writer.WriteStartArray();
        writer.WriteNumberValue(record.Id);
        writer.WriteStringValue(record.Name);
        writer.WriteNumberValue(record.LeagueId ?? 0);
        writer.WriteStringValue(record.League);
        writer.WriteEndArray();
    }

    writer.WriteEndArray();
}

static void WriteNamedRecords(
    Utf8JsonWriter writer,
    string propertyName,
    IEnumerable<NamedRecord> records)
{
    writer.WritePropertyName(propertyName);
    writer.WriteStartArray();

    foreach (var record in records)
    {
        writer.WriteStartArray();
        writer.WriteNumberValue(record.Id);
        writer.WriteStringValue(record.Name);
        writer.WriteEndArray();
    }

    writer.WriteEndArray();
}

[DllImport("kernel32.dll", SetLastError = true)]
static extern IntPtr OpenProcess(uint processAccess, bool inheritHandle, int processId);

[DllImport("kernel32.dll", SetLastError = true)]
static extern bool ReadProcessMemory(
    IntPtr processHandle,
    IntPtr baseAddress,
    [Out] byte[] buffer,
    int size,
    out IntPtr bytesRead);

[DllImport("kernel32.dll")]
static extern nuint VirtualQueryEx(
    IntPtr processHandle,
    IntPtr address,
    out MemoryBasicInformation memoryInformation,
    nuint length);

[DllImport("kernel32.dll")]
static extern bool CloseHandle(IntPtr handle);

[StructLayout(LayoutKind.Sequential)]
struct MemoryBasicInformation
{
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public nuint RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
}

record BirthDate(int Day, int Month, int Year, int DayOfYear);
record Rating(string Label, byte Value);
record NamedRecord(int Id, string Name);
record ClubRecord(int Id, string Name, int? LeagueId, string League);
record LeagueMembership(
    IReadOnlyDictionary<int, NamedRecord> Leagues,
    IReadOnlyDictionary<string, NamedRecord> ClubLeaguesByName);
record Cm4Ratings(
    int SquadNumber,
    ushort CurrentAbility,
    ushort PotentialAbility,
    ushort HomeReputation,
    ushort CurrentReputation,
    ushort WorldReputation,
    Rating[] Positions,
    Rating[] Sides,
    Rating[] Attributes,
    Rating[] MentalAttributes);
record Cm4NonPlayingRatings(
    ushort CurrentAbility,
    ushort PotentialAbility,
    ushort HomeReputation,
    ushort CurrentReputation,
    ushort WorldReputation,
    Rating[] Attributes,
    Rating[] MentalAttributes);
record Cm4Person(
    int Id,
    string FirstName,
    string SecondName,
    string CommonName,
    string DisplayName,
    BirthDate? BirthDate,
    ushort InternationalApps,
    ushort InternationalGoals,
    int? NationId,
    string Nation,
    int? ClubId,
    string Club,
    byte? JobCode,
    Cm4Ratings? PlayerRatings,
    Cm4NonPlayingRatings? NonPlayingRatings);
record NamedObjectMaps(
    IReadOnlyDictionary<uint, ClubRecord> Clubs,
    IReadOnlyDictionary<int, NamedRecord> Leagues,
    IReadOnlyDictionary<uint, string> Nations);
record Cm4RuntimeLayout(
    string ProcessName,
    string ProcessInstruction,
    uint PersonVtable,
    uint NonPlayingPersonVtable,
    uint PlayingDataVtable,
    uint NonPlayingDataVtable,
    uint PersonDataVtable,
    uint PersonNameVtable,
    int PlayerPrefixAdjustment,
    int PlayerAttributeCount,
    IReadOnlyCollection<(string Label, int Index)> AttributeIndexes)
{
    public static readonly Cm4RuntimeLayout Cm0304Editor = new(
        "cm data editor",
        "Open exactly one CM 03-04 Data Editor process with this database loaded.",
        0x006e52bc,
        0x006eb3d4,
        0x006c6350,
        0x006c7104,
        0x006c727c,
        0x006c6dd4,
        0,
        65,
        Cm4Schema.AttributeIndexes);

    public static readonly Cm4RuntimeLayout OriginalCm4 = new(
        "cm4",
        "Open exactly one CM4 game process and load or start a game using this database.",
        0x00a2f02c,
        0x00a30744,
        0x00a1d120,
        0x00a2df1c,
        0x00a1a5d0,
        0x00a154b0,
        8,
        63,
        Cm4Schema.OriginalCm4AttributeIndexes);
}

static class Cm4Schema
{
    public static readonly string[] PositionLabels =
    [
        "Goalkeeper",
        "Sweeper",
        "Defender",
        "Def Midfielder",
        "Midfielder",
        "Att Midfielder",
        "Attacker",
        "Wing back"
    ];

    public static readonly string[] SideLabels =
    [
        "Right side",
        "Left side",
        "Central",
        "Free role"
    ];

    public static readonly (string Label, int Index)[] SideIndexes =
    [
        ("Right side", 9),
        ("Left side", 10),
        ("Central", 11),
        ("Free role", 8)
    ];

    public static readonly (string Label, int Index)[] AttributeIndexes =
    [
        ("Acceleration", 47),
        ("Aggression", 58),
        ("Agility", 59),
        ("Anticipation", 29),
        ("Balance", 55),
        ("Bravery", 56),
        ("Consistency", 57),
        ("Corners", 40),
        ("Crossing", 12),
        ("Decisions", 30),
        ("Dirtiness", 54),
        ("Dribbling", 13),
        ("Finishing", 14),
        ("Flair", 39),
        ("Free Kicks", 48),
        ("Handling", 23),
        ("Heading", 15),
        ("Important Matches", 60),
        ("Injury Proneness", 61),
        ("Jumping", 52),
        ("Leadership", 53),
        ("Left Foot", 37),
        ("Long Shots", 16),
        ("Marking", 17),
        ("Off the Ball", 18),
        ("Natural Fitness", 63),
        ("One On Ones", 31),
        ("Pace", 51),
        ("Passing", 19),
        ("Penalties", 20),
        ("Positioning", 32),
        ("Reflexes", 33),
        ("Right Foot", 38),
        ("Stamina", 50),
        ("Strength", 49),
        ("Tackling", 21),
        ("Teamwork", 41),
        ("Technique", 36),
        ("Throw Ins", 34),
        ("Versatility", 62),
        ("Vision", 22),
        ("Work Rate", 42),
        ("First Touch", 35),
        ("Eccentricity", 44)
    ];

    public static readonly (string Label, int Index)[] OriginalCm4AttributeIndexes =
        AttributeIndexes
            .Where(item => item.Label is not "First Touch" and not "Eccentricity")
            .Select(item => (
                item.Label,
                item.Index -
                    (item.Index > 35 ? 1 : 0) -
                    (item.Index > 44 ? 1 : 0)))
            .ToArray();

    public static readonly string[] MentalAttributeLabels =
    [
        "Adaptability",
        "Ambition",
        "Controversy",
        "Loyalty",
        "Pressure",
        "Professionalism",
        "Sportsmanship",
        "Temperament"
    ];

    public static readonly string[] NonPlayingAttributeLabels =
    [
        "Attacking",
        "Business",
        "Coaching",
        "Coaching Goalkeepers",
        "Coaching Technique",
        "Directness",
        "Discipline",
        "Free Roles",
        "Interference",
        "Judging Ability",
        "Judging Potential",
        "Man Handling",
        "Marking",
        "Motivating",
        "Offside",
        "Patience",
        "Physiotherapy",
        "Pressing",
        "Resources",
        "Tactics",
        "Youngsters"
    ];

    public static readonly IReadOnlyDictionary<string, string> LeagueNames =
        new Dictionary<string, string>
        {
            ["bel_d1"] = "Belgian First Division",
            ["bel_d2"] = "Belgian Second Division",
            ["bel_d3a"] = "Belgian Third Division A",
            ["bel_d3b"] = "Belgian Third Division B",
            ["fra_fl1"] = "French First Division",
            ["fra_fl2"] = "French Second Division",
            ["ita_a"] = "Italian Serie A",
            ["ita_b"] = "Italian Serie B",
            ["ita_c1a"] = "Italian Serie C1/A",
            ["ita_c1b"] = "Italian Serie C1/B",
            ["ita_c2a"] = "Italian Serie C2/A",
            ["ita_c2b"] = "Italian Serie C2/B",
            ["ita_c2c"] = "Italian Serie C2/C"
        };
}
