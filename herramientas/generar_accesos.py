"""
Genera los accesos privados de cada vivienda de la promoción.

- En src/datos/promocion.json solo se guarda el hash SHA-256 de cada código
  (con el id de la promoción como sal): el código en claro no viaja en la web.
- Los enlaces se escriben en accesos-privados.csv (fuera del control de
  versiones) para que la promotora los entregue a cada comprador.

Uso:
  python3 herramientas/generar_accesos.py            # crea los que falten
  python3 herramientas/generar_accesos.py --todos    # regenera todos (invalida los anteriores)
"""

import csv
import hashlib
import json
import secrets
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PROMOCION = RAIZ / "src" / "datos" / "promocion.json"
SALIDA = RAIZ / "accesos-privados.csv"
ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789"  # sin caracteres ambiguos


def codigo():
    return "c-" + "".join(secrets.choice(ALFABETO) for _ in range(16))


def resumen(promocion_id, c):
    return hashlib.sha256(f"{promocion_id}:{c}".encode()).hexdigest()


def main():
    todos = "--todos" in sys.argv
    p = json.loads(PROMOCION.read_text())
    previos = {}
    if SALIDA.exists() and not todos:
        with SALIDA.open() as f:
            previos = {fila["vivienda"]: fila["codigo"] for fila in csv.DictReader(f)}

    filas = []
    for v in p["viviendas"]:
        c = previos.get(v["ref"])
        if todos or not v.get("acceso") or not c or resumen(p["id"], c) != v["acceso"]:
            c = codigo()
            v["acceso"] = resumen(p["id"], c)
        filas.append({"vivienda": v["ref"], "tipologia": v["tipologia"], "codigo": c, "enlace": f'{p["urlBase"]}#{c}'})

    PROMOCION.write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n")
    with SALIDA.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["vivienda", "tipologia", "codigo", "enlace"])
        w.writeheader()
        w.writerows(filas)
    for fila in filas:
        print(f'{fila["vivienda"]:10} {fila["enlace"]}')
    print("->", SALIDA)


if __name__ == "__main__":
    main()
