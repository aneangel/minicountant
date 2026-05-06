import sys
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

webview_datas   = collect_data_files('webview')
webview_hidden  = collect_submodules('webview')

a = Analysis(
    ['desktop.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        ('static',    'static'),
        ('templates', 'templates'),
        *webview_datas,
    ],
    hiddenimports=[
        *webview_hidden,
        # uvicorn internals not always auto-detected by PyInstaller
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # all routers (dynamic imports not always detected)
        'routers.accounts',
        'routers.budget',
        'routers.dashboard',
        'routers.goals',
        'routers.ingest',
        'routers.loans',
        'routers.recurring',
        'routers.rsus',
        'routers.simplefin',
        'routers.transactions',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# ── macOS: .app bundle (standard drag-to-Applications distribution) ──────────
if sys.platform == 'darwin':
    exe = EXE(
        pyz, a.scripts, [],
        exclude_binaries=True,
        name='minicountant',
        debug=False,
        strip=False,
        upx=False,
        console=False,
    )
    coll = COLLECT(
        exe, a.binaries, a.zipfiles, a.datas,
        strip=False,
        upx=False,
        name='minicountant',
    )
    app = BUNDLE(
        coll,
        name='Minicountant.app',
        bundle_identifier='com.minicountant.app',
        info_plist={
            'NSHighResolutionCapable': True,
            'NSRequiresAquaSystemAppearance': False,
            'CFBundleShortVersionString': '1.0.0',
            'CFBundleDisplayName': 'Minicountant',
        },
    )

# ── Linux / Windows: single-file executable ──────────────────────────────────
else:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name='minicountant',
        debug=False,
        strip=False,
        upx=True,
        console=False,
        bootloader_ignore_signals=False,
    )
