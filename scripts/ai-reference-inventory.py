"""Read-only workbook reconciliation. Output is staging evidence, never a seed payload.

Usage: python scripts/ai-reference-inventory.py SOURCE_DIRECTORY OUTPUT_JSON
Requires openpyxl in the development runtime. Never saves either workbook.
"""
import hashlib
import json
import pathlib
import sys
import warnings
import openpyxl

source = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
risk_file = source / 'أداة_إدارة_مخاطر_الذكاء_الاصطناعي_سدايا (1).xlsx'
adoption_file = source / 'أداة_تقييم_تبنى_حالة_استخدام_الذكاء_الاصطناعي.xlsx'
expected_hashes = ['96fa526e69423c14103afa6fea339c219c0778a21b1cd308f2695e806dcc103c',
                   'db7995f60098136ccee27e29590453362d055b7a0413f71d79aafdc57d3984f1']
books = {}
hashes = {}
for key, file, expected in zip(['risk', 'adoption'], [risk_file, adoption_file], expected_hashes):
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    if digest != expected:
        raise ValueError(f'{key} workbook differs from the receipt checkpoint')
    hashes[key] = digest
    # These extensions are only relevant when saving; this extractor never saves.
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        books[key] = openpyxl.load_workbook(file, data_only=False)

adoption_names = 'L_HUMAN L_STAGE L_MODEL L_AVAIL L_YN L_CLASS L_BUDGET L_COMPLETENESS L_DECISION L_TIER L_TIER_SCORE L_STREAMS L_PROGRAMS L_FUNCTIONS'.split()
risk_names = dict(zip(
    'R_DEPT R_TECH R_LIFECYCLE R_YN R_RELIANCE R_HITL R_UCSTATUS R_RISKCAT R_CTRLEFF R_STRATEGY R_TREATSTATUS R_ACTTYPE R_PRIORITY R_LEVEL R_SCORE14 R_IMPD R_CADENCE R_SDAIA_TIER R_ETHICS R_SDAIA_SCORE R_SOURCE R_INTENT R_TIMING'.split(),
    'L_DEPT L_TECH L_LIFECYCLE L_YESNO L_RELIANCE L_HUMAN L_UCSTATUS L_RISKCAT L_CTRLEFF L_RESPONSE L_ACTSTATUS L_ACTTYPE L_PRIORITY L_LEVEL L_SCORE L_IMPDIM L_CADENCE L_TIER L_PRINCIPLE L_TIER_SCORE L_SOURCE L_INTENT L_TIMING'.split()))
aliases = {'L_YN':'R_YN','L_TIER':'R_SDAIA_TIER','L_TIER_SCORE':'R_SDAIA_SCORE','L_FUNCTIONS':'R_DEPT'}
def extract(book, name):
    definition = books[book].defined_names[name]
    cells = []
    for sheet, address in definition.destinations:
        for row in books[book][sheet][address]:
            for cell in row:
                if cell.value is not None:
                    cells.append({'cell': f'{sheet}!{cell.coordinate}', 'value': cell.value, 'formula': cell.data_type == 'f'})
    return {'namedRange': name, 'range': definition.attr_text, 'count': len(cells), 'cells': cells}
entries = []
for code in adoption_names:
    entries.append({'code':code,'canonical':aliases.get(code,code),'workbook':'adoption',**extract('adoption',code)})
for code, name in risk_names.items():
    entries.append({'code':code,'canonical':code,'workbook':'risk',**extract('risk',name)})
entries.append({'code':'R_MINSCORE','canonical':'R_MINSCORE','workbook':'risk','components':[extract('risk','L_TIER'),extract('risk','T_MIN')]})
entries.append({'code':'R_LEVEL_DAYS','canonical':'R_LEVEL_DAYS','workbook':'risk','components':[extract('risk','T_LEVEL'),extract('risk','T_DAYS')]})
entries.append({'code':'R_CATMAP','canonical':'R_CATMAP','workbook':'risk','status':'unresolved: no matching named range; source matrix requires explicit mapping'})
by_code = {e['code']: e for e in entries}
issues = []
for code, expected in {'R_DEPT':19,'R_YN':2,'L_FUNCTIONS':11,'L_PROGRAMS':19,'L_STREAMS':9}.items():
    actual = by_code[code]['count']
    if actual != expected:
        issues.append({'code':code,'issue':'count differs from FD §7.2','designCount':expected,'sourceCount':actual})
for alias, canonical in aliases.items():
    left = [c['value'] for c in by_code[alias]['cells']]
    right = [c['value'] for c in by_code[canonical]['cells']]
    unmatched = [v for v in left if v not in right]
    if unmatched:
        issues.append({'code':alias,'issue':'exact-label unification requires mapping','canonical':canonical,'unmatchedLabels':unmatched})
issues.append({'code':'R_CATMAP','issue':'source matrix unresolved'})
issues.append({'issue':'English value codes, translations and go-live effective date require reviewed mapping; staging values are not publishable seeds'})
result = {'status':'staged-not-publishable','sourceHashes':hashes,'registrationCount':len(entries),'canonicalConceptCount':len(set(e['canonical'] for e in entries)), 'entries':entries,'issues':issues}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
for workbook in books.values():
    workbook.close()
print(json.dumps({'registrations':len(entries),'issues':issues},ensure_ascii=False,indent=2))
