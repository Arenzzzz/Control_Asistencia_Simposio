import random
import pytest

from Clasificador import AMARILLA, ROJA, VERDE, Config, clasificar_lote
from matcher import Padron, damerau_levenshtein
from Normalizador import normalize_name, tokenize

CFG = Config(tarifa=50.0)

PADRON = [
    {"carnet": "202100001", "nombre": "Juan Carlos Pérez Gómez"},
    {"carnet": "202100002", "nombre": "Juana María López Díaz"},
    {"carnet": "202100003", "nombre": "Juan Pablo Pérez Ruiz"},
    {"carnet": "202100004", "nombre": "María de los Ángeles Castillo Ramírez"},
    {"carnet": "202100005", "nombre": "Luis Fernando Morales Soto"},
    {"carnet": "202100006", "nombre": "Ana Lucía Herrera Cruz"},
]

def pago(boleta, nombre, monto=50):
    return {"boleta": boleta, "nombre": nombre, "monto": monto}

def zona(pagos):
    return [r.zona for r in clasificar_lote(pagos, Padron(PADRON), CFG)]

def test_distancia():
    assert damerau_levenshtein("PEREZ", "PERZE") == 1
    assert damerau_levenshtein("JUAN", "JUANA") == 1
    assert damerau_levenshtein("ANA", "LUIS") == 4
    assert damerau_levenshtein("ABCDEFG", "XYZ", max_dist=2) == 3

def test_normalizacion():
    assert normalize_name("  Pérez-Gómez,  Ñandú. ") == "PEREZ GOMEZ NANDU"
    assert tokenize("María de los Ángeles") == ["MARIA", "ANGELES"]

def test_verde_nombre_incompleto():
    assert zona([pago("1", "Luis Morales")]) == [VERDE]
    assert zona([pago("2", "ana lucia herrera")]) == [VERDE]
    assert zona([pago("3", "Maria Angeles Castillo")]) == [VERDE]

def test_verde_con_nombre_de_mas_en_la_boleta():
    # la boleta trae el segundo nombre y el padrón no
    padron = Padron([{"carnet": "1052124", "nombre": "Anthony Dominguez Arriola"}])
    r = clasificar_lote([pago("10", "ANTHONY RAFAEL DOMINGUEZ ARRIOLA")], padron, CFG)[0]
    assert (r.zona, r.carnet_asignado) == (VERDE, "1052124")
    assert zona([pago("11", "Ana Lucia Herrera Cruz_x000D_")]) == [VERDE]

def test_verde_con_typo_y_transposicion():
    assert zona([pago("4", "Luis Moralse")]) == [VERDE]

def test_amarilla_colision_k0_y_k1():
    assert zona([pago("5", "Juan Perez")]) == [AMARILLA]

def test_amarilla_homonimo_corto():
    assert zona([pago("6", "Juana")]) == [AMARILLA]

def test_amarilla_unico_k2():
    assert zona([pago("7", "Luis Fernndo Morlaes")]) in ([AMARILLA], [VERDE])

def test_roja_sin_coincidencia():
    assert zona([pago("8", "Pedro Zacarias")]) == [ROJA]

def test_roja_contable():
    assert zona([pago("9", "Luis Morales", monto=40)]) == [ROJA]

def test_roja_boleta_duplicada():
    z = zona([pago("77", "Luis Morales"), pago("0077", "Ana Herrera")])
    assert z == [ROJA, ROJA]

def _ruido(nombre, rng):
    toks = nombre.split()
    toks = rng.sample(toks, k=min(len(toks), rng.choice([2, 3])))
    toks.sort(key=nombre.split().index)
    s = " ".join(toks)
    if rng.random() < 0.5:
        i = rng.randrange(len(s) - 1)
        if s[i] != " " and s[i + 1] != " ":
            s = s[:i] + s[i + 1] + s[i] + s[i + 2:]
    return s

def test_precision_sintetica():
    rng = random.Random(7)
    nombres = ["Alejandro", "Beatriz", "Cristian", "Daniela", "Esteban", "Fabiola"]
    apes = ["Aguilar", "Barrios", "Cifuentes", "Donis", "Estrada", "Figueroa"]
    padron, vistos = [], set()
    while len(padron) < 800:
        n = f"{rng.choice(nombres)} {rng.choice(nombres)} {rng.choice(apes)} {rng.choice(apes)}"
        if n not in vistos:
            vistos.add(n)
            padron.append({"carnet": str(2020_00000 + len(padron)), "nombre": n})
    pagos, esperado = [], []
    for i, p in enumerate(rng.sample(padron, 300)):
        pagos.append(pago(str(1000 + i), _ruido(p["nombre"], rng)))
        esperado.append(p["carnet"])
    
    res = clasificar_lote(pagos, Padron(padron), CFG)
    verdes = [(r, e) for r, e in zip(res, esperado) if r.zona == VERDE]
    erroneos = [r for r, e in verdes if r.carnet_asignado != e]
    precision_verde = 1 - len(erroneos) / max(1, len(verdes))
    assert precision_verde >= 0.95

# ---- Docentes (Q150) y estudiantes (Q300) -----------------------------------
from Clasificador import separar_padron

PADRON_MIXTO = PADRON + [
    {"carnet": "D001", "nombre": "Luis Fernando Morales Soto", "tipo": "DOCENTE"},   # homónimo de un estudiante
    {"carnet": "D002", "nombre": "Roberto Carlos Méndez Arriola", "tipo": "DOCENTE"},
]
CFG_DOS = Config(tarifa=300.0, tarifa_docente=150.0)

def zona_mixta(pagos):
    return [(r.zona, r.carnet_asignado, r.motivo) for r in clasificar_lote(pagos, separar_padron(PADRON_MIXTO), CFG_DOS)]

def test_docente_q150_verde():
    assert zona_mixta([pago("D1", "Roberto Mendez Arriola", 150)])[0][:2] == (VERDE, "D002")

def test_monto_decide_el_tipo_ante_homonimos():
    # El mismo nombre existe como estudiante y como docente: el monto decide quién es
    assert zona_mixta([pago("E1", "Luis Fernando Morales", 300)])[0][:2] == (VERDE, "202100005")
    assert zona_mixta([pago("E2", "Luis Fernando Morales", 150)])[0][:2] == (VERDE, "D001")

def test_estudiante_con_tarifa_docente_no_se_asigna():
    # Un estudiante que paga Q150 no queda a su nombre: no hay docente con ese nombre
    assert zona_mixta([pago("E3", "Ana Lucia Herrera", 150)])[0][0] == ROJA

def test_monto_distinto_a_ambas_tarifas():
    assert zona_mixta([pago("X1", "Roberto Mendez", 200)])[0][0] == ROJA

def test_sin_tarifa_docente_q150_es_roja():
    r = clasificar_lote([pago("X2", "Roberto Mendez Arriola", 150)], separar_padron(PADRON_MIXTO), Config(tarifa=300.0))
    assert r[0].zona == ROJA

def test_boleta_docente_sin_docentes_cargados():
    r = clasificar_lote([pago("X3", "Roberto Mendez", 150)], separar_padron(PADRON), CFG_DOS)
    assert (r[0].zona, r[0].motivo) == (ROJA, "sin_padron_docente")
