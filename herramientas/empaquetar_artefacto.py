#!/usr/bin/env python3
"""Empaqueta dist/ como página de artefacto (claude.ai) en dist-artefacto/.

La página del artefacto es el <body> de dist/index.html precedido de su
<title> y de los <script>/<link> del <head>; los assets van al lado, con las
mismas rutas relativas. Se ejecuta tras `npm run build` (o con
`npm run artefacto`, que hace las dos cosas).
"""
import json, pathlib, re, shutil

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIST, SALIDA = RAIZ / 'dist', RAIZ / 'dist-artefacto'
TITULO = 'Vivienda Planta Baja A'

html = (DIST / 'index.html').read_text()
cabeza = html[html.index('<head>') + 6:html.index('</head>')]
etiquetas = re.findall(r'<script[^>]*></script>|<link[^>]*>', cabeza)
cuerpo = html[html.index('<body'):]
cuerpo = cuerpo[cuerpo.index('>') + 1:cuerpo.rindex('</body>')].strip()

shutil.rmtree(SALIDA, ignore_errors=True)
shutil.copytree(DIST / 'assets', SALIDA / 'assets')
(SALIDA / 'visor.html').write_text(
    f'<title>{TITULO}</title>\n' + '\n'.join(etiquetas) + '\n' + cuerpo
    + '\n<script>document.body.dataset.estado="4";document.body.dataset.modo="vivienda";</script>\n')
ficheros = {f'assets/{p.name}': f'assets/{p.name}' for p in sorted((SALIDA / 'assets').iterdir())}
(SALIDA / 'ficheros.json').write_text(json.dumps(ficheros, indent=1))
print(f'{SALIDA / "visor.html"} + {len(ficheros)} assets')
