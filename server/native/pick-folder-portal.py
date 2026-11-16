#!/usr/bin/env python3
"""Open the desktop's own folder chooser through the XDG desktop portal (Linux: GNOME, KDE, Sway...).
Usage: pick-folder-portal.py "<title>" [start folder]
Prints {"path": "..."} or {"cancelled": true} or {"error": "..."} as JSON. Needs python3 with PyGObject (gi)."""
import json, random, string, sys, urllib.parse

try:
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib
except Exception as e:  # PyGObject missing
    print(json.dumps({'error': f'PyGObject not available: {e}'}))
    sys.exit(0)

title = sys.argv[1] if len(sys.argv) > 1 else 'Choose a folder'
start = sys.argv[2] if len(sys.argv) > 2 else ''

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
token = 'jade' + ''.join(random.choices(string.ascii_lowercase, k=10))
sender = bus.get_unique_name()[1:].replace('.', '_')
request_path = f'/org/freedesktop/portal/desktop/request/{sender}/{token}'
loop = GLib.MainLoop()
result = {}


def on_response(_conn, _sender, _path, _iface, _signal, params):
    code, results = params.unpack()
    if code == 0:
        uris = results.get('uris', [])
        result['path'] = urllib.parse.unquote(urllib.parse.urlparse(uris[0]).path) if uris else ''
    else:
        result['cancelled'] = True
    loop.quit()


# Subscribe before calling, so the response can't be missed. The process must stay alive until the user picks:
# the portal cancels the dialog if the caller disconnects.
bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request', 'Response',
                     request_path, None, Gio.DBusSignalFlags.NONE, on_response)
options = {
    'handle_token': GLib.Variant('s', token),
    'directory': GLib.Variant('b', True),
    'modal': GLib.Variant('b', True),
    'accept_label': GLib.Variant('s', 'Choose folder'),
}
if start:
    options['current_folder'] = GLib.Variant('ay', list((start + '\0').encode()))
try:
    bus.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', 'org.freedesktop.portal.FileChooser',
                  'OpenFile', GLib.Variant('(ssa{sv})', ('', title, options)), None, Gio.DBusCallFlags.NONE, -1, None)
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(0)
loop.run()
print(json.dumps(result))
