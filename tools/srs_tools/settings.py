"""Machine settings stay in ignored local configuration, never in source."""
from datetime import datetime, timezone
from importlib.resources import files
import os
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from .configuration import parse_json

ROOT = Path(__file__).resolve().parents[2]


def local_settings():
    path = Path(os.environ.get('SRS_SETTINGS', ROOT / 'config/local.json')).expanduser()
    if not path.exists():
        return {}
    settings = parse_json(path.read_text(encoding='utf-8'), str(path))
    if not isinstance(settings, dict) or settings.keys() - {'vault', 'timezone'}:
        raise ValueError(f'{path}: expected an object with vault and/or timezone')
    for key, value in settings.items():
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ValueError(f'{path}: {key} must be a non-empty string or null')
    if settings.get('vault'):
        vault = Path(settings['vault']).expanduser()
        settings['vault'] = vault if vault.is_absolute() else path.parent / vault
    return settings


def default_vault():
    value = os.environ.get('SRS_VAULT') or local_settings().get('vault')
    return Path(value).expanduser().resolve() if value else ROOT.parent


def system_timezone():
    """Resolve the OS zone to an IANA name shared by Python, Anki, and JS."""
    explicit = os.environ.get('TZ')
    if explicit and not explicit.startswith((':', '/')):
        ZoneInfo(explicit)  # Report an invalid override rather than guessing.
        return explicit
    localtime = Path(explicit.lstrip(':')) if explicit else Path('/etc/localtime')
    candidates = []
    resolved = str(localtime.resolve())
    if '/zoneinfo/' in resolved:
        candidates.append(resolved.split('/zoneinfo/', 1)[1])
    timezone_file = Path('/etc/timezone')
    if not explicit and timezone_file.is_file():
        candidates.append(timezone_file.read_text().strip())
    candidates.append(getattr(datetime.now().astimezone().tzinfo, 'key', None))
    for candidate in candidates:
        if candidate:
            try:
                ZoneInfo(candidate)
                return candidate
            except (ValueError, ZoneInfoNotFoundError):
                pass
    # Some systems install a copy of the zone file rather than a symlink.
    if localtime.is_file():
        content = localtime.read_bytes()
        resource = files('tzdata.zoneinfo')
        equivalent = []
        for name in sorted(available_timezones()):
            zonefile = resource.joinpath(*name.split('/'))
            if zonefile.is_file():
                candidate = zonefile.read_bytes()
                if candidate == content:
                    return name
                # Slim and full TZif files encode the same zone differently.
                # Match the future rule, then check historical/local behavior.
                if content.endswith(b'\n') and content.split(b'\n')[-2] == candidate.split(b'\n')[-2]:
                    equivalent.append(name)
        with localtime.open('rb') as stream:
            local_zone = ZoneInfo.from_file(stream)
        year = datetime.now().year
        stamps = [datetime(y, month, 15, 12, tzinfo=timezone.utc).timestamp()
                  for y in range(1970, year + 11) for month in range(1, 13)]
        def signature(zone):
            return [(d.utcoffset(), d.dst(), d.tzname())
                    for d in (datetime.fromtimestamp(stamp, zone) for stamp in stamps)]
        expected = signature(local_zone)
        for name in equivalent:
            if signature(ZoneInfo(name)) == expected:
                return name
    if datetime.now().astimezone().utcoffset().total_seconds() == 0:
        return 'UTC'
    raise ValueError('Cannot determine system timezone; set TZ, --timezone, or config/local.json timezone')


def default_timezone():
    name = local_settings().get('timezone')
    if name:
        ZoneInfo(name)
        return name
    return system_timezone()
