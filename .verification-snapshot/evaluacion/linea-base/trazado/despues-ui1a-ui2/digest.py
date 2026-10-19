"""Resumen compacto por caso/corrida de cada etapa (blueprint, argumentos del chat, plan resuelto).
Solo lee los artefactos guardados en trazado/. Uso: python digest.py [casos] > digest.txt"""
import json, sys, os, re

T = os.environ.get('TRAZADO_DIR') or os.path.dirname(os.path.abspath(__file__))


def load(p):
    try:
        return json.load(open(p, encoding='utf8'))
    except Exception:
        return None


def mat(m):
    return f"{m.get('color')}/{m.get('acabado') or '-'} {m.get('participacion')} {m.get('rol_material')}"


def digest(c, k):
    d = f"{T}/caso-{c}/corrida-{k}"
    out = []
    bp = load(f"{d}/blueprint.json")
    args = load(f"{d}/confirmar-args.json")
    plan = load(f"{d}/plan-resuelto.json")
    if bp:
        for e in bp['elements']:
            if e['category'] != 'balloon_structure':
                continue
            a = e['appearance']
            vs = e.get('visual_semantics') or {}
            out.append(f"BP {e['element_id']} {e['name']!r} tipo={vs.get('structure_type')} lugar={vs.get('placement')} dens={vs.get('density')} incl={a.get('inclinacion')}")
            out.append(f"   shape={a['shape']!r}")
            out.append(f"   obs={a['observed_colors']} med={[(m['color'], round(m['share'],2)) for m in a.get('measured_colors', [])][:5]}")
            out.append(f"   refs={[(r['nombre_completo'], round(r['parte'],2), 'F' if r.get('familia_fiable') else 'a') for r in a.get('referencias_medidas', [])]}")
            ex = {k2: a[k2] for k2 in ('conteo', 'tamanos_leidos', 'patron_color', 'remate', 'curva', 'armado_guirnalda') if k2 in a}
            if ex:
                out.append(f"   extra={json.dumps(ex, ensure_ascii=False)[:420]}")
    if args:
        for e in args['estructuras']:
            out.append(f"ARGS {e['estructura_id']} tipo={e['tipo']} oficial={e.get('estructura_oficial')} nombre={e['nombre']!r} ref={e.get('referencia_element_id')} med={e.get('medidas')} rep={e.get('repeticiones')} dens={e['densidad']} mezcla={e['mezcla']} unid={e.get('unidades_declaradas')}")
            out.append(f"   mats={[mat(m) for m in e['materiales']]}")
        out.append(f"   omitidas={[ (o['element_id'], o['motivo_tipo']) for o in args.get('referencia_omitida', [])]}")
    if plan:
        res = {e['estructura_id']: e for e in plan['estructuras']}
        for e in plan['plan']['estructuras']:
            out.append(f"PLAN {e['estructura_id']} tipo={e['tipo']} oficial={e.get('estructura_oficial')} med={e.get('medidas')} rep={e.get('repeticiones')} dens={e['densidad']} mezcla={e['mezcla']} colref={e.get('colores_referencia')}")
            out.append(f"   mats={[mat(m) for m in e['materiales']]}")
            for key in ('armado_arco_organico', 'armado_columna_organica', 'armado_guirnalda', 'armado_arco', 'armado_columna', 'armado_bouquet'):
                if key in e:
                    arm = e[key]
                    out.append(f"   {key}: forma={json.dumps(arm.get('forma'), ensure_ascii=False)} tam={json.dumps((arm.get('tamanos') or {}).get('mezcla'))} pal={json.dumps((arm.get('colores') or {}).get('paleta'), ensure_ascii=False)[:300]}")
            r = res.get(e['estructura_id'])
            if r:
                out.append(f"   RES total={r['total_unidades']} mezcla_real={json.dumps(r['mezcla_real'], ensure_ascii=False)[:260]} eje_m={r.get('eje_m')}")
        sust = [(s['pedido'], s['entregado']) for s in plan.get('sustituciones', [])]
        adv = [a for a in plan.get('advertencias', []) if not a.startswith('sobrante')]
        out.append(f"   sust={sust} adv={adv[:6]} sin_cob={plan.get('sin_cobertura')}")
        out.append(f"   compras={sorted(set(re.sub(r' . R-\\d+.*', '', c['titulo']).replace('B2b Globo Latex Redondo ', '') for c in plan['compras']))}")
    return '\n'.join(out)


if __name__ == '__main__':
    casos = [int(x) for x in (sys.argv[1].split(',') if len(sys.argv) > 1 else '1,2,3,4,5,6,7,8'.split(','))]
    for c in casos:
        for k in (1, 2, 3):
            print(f"\n######## CASO {c} CORRIDA {k}")
            print(digest(c, k))
