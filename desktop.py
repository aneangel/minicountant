import sys
import threading
import socket
import time


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def _wait_for_server(port, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def _check_linux_deps():
    try:
        import gi
        gi.require_version('WebKit2', '4.0')
        from gi.repository import WebKit2  # noqa: F401
    except Exception:
        sys.exit(
            'Minicountant requires WebKit2GTK on Linux.\n\n'
            'Install it with:\n'
            '  Ubuntu/Debian:  sudo apt install python3-gi gir1.2-webkit2-4.0\n'
            '  Fedora:         sudo dnf install python3-gobject webkit2gtk4.0\n'
            '  Arch:           sudo pacman -S python-gobject webkit2gtk\n'
        )


def _run_server(port):
    import uvicorn
    from main import app
    uvicorn.run(app, host='127.0.0.1', port=port, log_level='warning')


def main():
    if sys.platform.startswith('linux'):
        _check_linux_deps()

    port = _find_free_port()

    thread = threading.Thread(target=_run_server, args=(port,), daemon=True)
    thread.start()

    if not _wait_for_server(port, timeout=15):
        sys.exit('Minicountant: server failed to start within 15 seconds.')

    import webview
    webview.create_window(
        'Minicountant',
        f'http://127.0.0.1:{port}',
        width=1280,
        height=800,
        min_size=(800, 600),
    )
    webview.start()


if __name__ == '__main__':
    main()
