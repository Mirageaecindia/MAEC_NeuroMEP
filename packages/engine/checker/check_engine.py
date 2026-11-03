"""WBS 1.6.8 - independent checker of the NeuroMEP engine (design doc Section 11, NFR Reliability).

Reads the inputs and results written by run.ts and recomputes them with separate code:
  - the CableSizer v1.1 tables straight from the source record
    docs/reference/cablesizer_lookup_rules.json (its "when" expressions are evaluated here, not the
    typed tables the engine reads); "else = 1" default rows count as not found (V-14);
  - the Dubai rule pack JSON (breaker ratings, DEWA minimum, limits, transformer uk).

Per feeder: cable length, Ib (10.4), In (10.5), Iz and C1 (10.6), own and cumulative voltage drop
and C2 (10.7), DEWA minimum C6 (10.11) and Ik"max at the breaker by the CableSizer method (10.8).
Exit code 0 when every value agrees within the tolerance, 1 otherwise.

    python check_engine.py <engine-results.json> <repository root>
"""

import json
import math
import re
import sys
from pathlib import Path

REL = 1e-6  # relative tolerance; both sides use doubles and the same formulas
VN, VPH = 400.0, 230.0
SQRT3 = math.sqrt(3)
RHO = {"Cu": 18.32, "Al": 30.34}  # mOhm mm2/m (CableSizer)


class Tables:
    """CableSizer lookup functions: first matching rule wins; default rows are 'not found'."""

    def __init__(self, path):
        self.fns = json.loads(Path(path).read_text(encoding="utf-8"))
        self.compiled = {
            name: [(compile(r["when"], name, "eval"), r) for r in fn["rules"]]
            for name, fn in self.fns.items()
        }

    def value(self, fn, **args):
        for code, rule in self.compiled[fn]:
            if eval(code, {"__builtins__": {}}, args):  # noqa: S307 - expressions from the repo
                v = rule["value"]
                if rule.get("default") or not isinstance(v, (int, float)):
                    return None
                return float(v)
        return None

    def steps(self, fn, key):
        found = set()
        for rule in self.fns[fn]["rules"]:
            for m in re.finditer(rf"\b{key}\s*==\s*([0-9.]+)", rule["when"]):
                found.add(float(m.group(1)))
        return sorted(found)

    def conservative(self, fn, key, x, **args):
        """Exact step, else the lower factor of the two neighbouring steps (manager 3 Nov 2026)."""
        exact = self.value(fn, **args, **{key: x})
        if exact is not None:
            return exact
        lo = [self.value(fn, **args, **{key: s}) for s in self.steps(fn, key) if s < x]
        hi = [self.value(fn, **args, **{key: s}) for s in self.steps(fn, key) if s > x]
        lo = [v for v in lo if v is not None]
        hi = [v for v in hi if v is not None]
        if not lo or not hi:
            return None
        return min(lo[-1], hi[0])


class Pack:
    def __init__(self, path):
        self.d = json.loads(Path(path).read_text(encoding="utf-8"))
        self.defaults = {c["key"]: c.get("value") for c in self.d["calculationDefaults"]}

    def num(self, key, overrides):
        v = overrides.get(key)
        return v if isinstance(v, (int, float)) else self.defaults.get(key)

    def breaker(self, ib):
        return next((r for r in self.d["devices"]["breakerRatingsA"] if r >= ib), None)

    def dewa_minimum(self, rating):
        rows = self.d["devices"]["dewaMinimumCable"]["rows"]
        return next((r for r in rows if r["breakerA"] >= rating), None)

    def uk(self, kva, primary_v):
        kv = primary_v / 1000 if primary_v else 11
        group = next(g for g in self.d["sourceData"]["transformerUkPct"] if kv <= g["maxPrimaryKv"])
        row = next((r for r in group["rows"] if kva <= r["maxKva"]), None)
        return row["ukPct"] if row else None


def limit_key(kind):
    if kind in ("lv-panel", "mdb", "emdb", "acb-panel"):
        return "MDB"
    if kind in ("smdb", "esmdb"):
        return "SMDB"
    if kind in ("mcc", "emcc"):
        return "MCC"
    return {"db": "DB", "motor": "Motor"}.get(kind, "FinalCircuits")


def route_length(route):
    return sum(math.dist((a["x"], a["y"]), (b["x"], b["y"])) for a, b in zip(route, route[1:]))


def ins_key(c):
    if c["insulation"] != "FR":
        return c["insulation"]
    return "XLPE" if c["method"] == "J" else None


def method_key(c):
    return {"B": "B", "J": "J"}.get(c["method"], "D")


def rating(t, c, phases, size, runs, site):
    """Iz = It x K1 x K2 x Kr x K3 x runs (10.6); None when a value is missing."""
    ins = ins_key(c)
    fn = "NOMRATCU" if c["conductor"] == "Cu" else "NOMRATAL"
    it = t.value(fn, PHASE=phases, CORE=c["cores"], METHOD=method_key(c), INS=ins, size=size)
    buried = method_key(c) == "D"
    temp = site["groundC"] if buried else site["airC"]
    k1 = t.conservative("TEMPDE", "TEMP", temp, METHOD=method_key(c), TYP=ins)
    sep = "TOUCHING" if c["separation"] == "touching" else c["separation"]
    if c["method"] == "B":
        k2 = t.value("GROUPB", CIR=c["groupedCircuits"])
    elif c["method"] == "J":
        k2 = t.value("GROUPJ", CORE=c["cores"], CIR=c["groupedCircuits"], SEP=sep, no=c["trays"])
    else:
        bury = "DUCT" if c["method"] == "D-duct" else "DIRECT BURIED"
        sep = sep if sep == "TOUCHING" else float(sep)
        k2 = t.value("GROUPD", CORE=c["cores"], BURY=bury, CIR=c["groupedCircuits"], SEP=sep)
    kr = k3 = 1.0
    if buried:
        bury = "DUCT" if c["method"] == "D-duct" else "DIRECT BURIED"
        base = dict(METHOD=bury, CORE=c["cores"], size=size)
        kr = t.conservative("STR", "RESISTIVITY", site["soilResistivity"], **base)
        k3 = t.conservative("DLAY", "DEPTH", c["depthM"], **base)
    if None in (it, k1, k2, kr, k3):
        return None
    return it * k1 * k2 * kr * k3 * runs


def drop_pct(t, c, phases, size, runs, ib, pf, length):
    """Own voltage drop, % (10.7): mV/A/m below 25 mm2, r cos + x sin from 25 mm2."""
    ins = ins_key(c)
    if size < 25:
        vu = t.value("VU", CAB=size, TYP=ins, PHASES=phases)
    else:
        pvc = ins == "PVC"
        r = t.value("RESISPVC" if pvc else "RESIS", CAB=size)
        x = t.value("REACTPVC" if pvc else "REACT", CAB=size)
        if r is None or x is None:
            return None
        vu = r * pf + x * math.sin(math.acos(pf))
        if phases == 1:
            vu *= 2 / SQRT3
    if vu is None:
        return None
    return ib * length * vu / (1000 * runs) / (VPH if phases == 1 else VN) * 100


def check_building(b, t, pack, fail):
    elements = {e["id"]: e for e in b["elements"]}
    cables = {c["id"]: c for c in b["cables"]}
    results = {r["cableId"]: r for r in b["results"]}
    into = {c["to"]: c for c in b["cables"]}
    children = {}
    for c in b["cables"]:
        children.setdefault(c["from"], []).append(c["to"])

    df = b["demandFactors"]
    factors = [v["value"] for v in df["byCategory"].values()]
    factors += [v["value"] for v in df["byLoadType"].values()] + [df["secondLevel"]["value"]]
    if any(f != 1 for f in factors):
        fail(b, "-", "checker assumes demand factors of 1 (random buildings)")
        return

    def demand(eid):
        """kW per phase and reactive kVAr below a component (factors 1)."""
        e = elements[eid]
        p = [0.0, 0.0, 0.0]
        q = 0.0
        for load in e["loads"]:
            kw = [load["kwL1"], load["kwL2"], load["kwL3"]]
            p = [a + k for a, k in zip(p, kw)]
            q += sum(kw) * math.tan(math.acos(e["powerFactor"]))
        for ch in children.get(eid, []):
            cp, cq = demand(ch)
            p = [a + k for a, k in zip(p, cp)]
            q += cq
        return p, q

    add_m = pack.num("cableLengthAdditionM", b["overrides"])
    allow = pack.num("cableLengthAllowancePct", b["overrides"]) or 0
    own_pct = {}  # the checker's own drop of each cable

    def total_drop(cid):
        """Cumulative drop at the end of a cable: 0 at the transformer, the board above at its full
        allowance when the drop into it is unknown (10.13)."""
        c = cables[cid]
        own = own_pct.get(cid)
        if own is None:
            return None
        frm = elements[c["from"]]
        if frm["kind"] == "transformer":
            return own
        up = total_drop(into[frm["id"]]["id"]) if frm["id"] in into else None
        if up is None:
            up = pack.num(f"voltageDropLimitPct.{limit_key(frm['kind'])}", b["overrides"])
        return up + own

    def close(a, b_, what, cid):
        if a is None or b_ is None:
            if a != b_:
                fail(b, cid, f"{what}: checker {a} vs engine {b_}")
            return
        if abs(a - b_) > REL * max(1.0, abs(a)):
            fail(b, cid, f"{what}: checker {a:.6f} vs engine {b_:.6f}")

    for cid, c in cables.items():
        r = results[cid]
        to = elements[c["to"]]
        # Length (A-05, 3 Nov 2026): routed + fixed addition (+ allowance).
        routed = route_length(c["route"])
        base = routed + (add_m if add_m is not None else c["verticalM"])
        close(base * (1 + allow / 100), r["lengthM"], "length", cid)
        if r["status"] == "awaiting-load" or r["ibA"] is None:
            continue
        # Ib (10.4) - also for feeders the engine blocked later on a missing table value.
        p, q = demand(to["id"])
        total = sum(p)
        pf = total / math.hypot(total, q) if children.get(to["id"]) else to["powerFactor"]
        phases_on = sum(1 for x in p if x > 0)
        if phases_on == 3 and p[0] == p[1] == p[2]:
            ib = total * 1000 / (SQRT3 * VN * pf)
        else:
            ib = max(p) * 1000 / (VPH * pf)
        close(ib, r["ibA"], "Ib", cid)
        # In (10.5) and the DEWA minimum (C6).
        rated = pack.breaker(ib)
        close(rated, r["inA"], "In", cid)
        if r["sizeMm2"] is None:
            continue
        # C2: own drop at the engine's final size (a cable blocked on its rating still has one).
        phases = 1 if phases_on == 1 else 3
        own = drop_pct(t, c["construction"], phases, r["sizeMm2"], r["runs"], ib, pf, r["lengthM"])
        close(own, r["vdOwnPct"], "Vd own", cid)
        own_pct[cid] = own
        if r["status"] == "blocked":
            continue
        dewa = pack.dewa_minimum(rated)
        if dewa and r["sizeMm2"] * r["runs"] < dewa["sizeMm2"] * dewa["runs"]:
            fail(b, cid, f"C6: {r['runs']} x {r['sizeMm2']} mm2 below DEWA {dewa['sizeMm2']} mm2")
        # C1 at the engine's final size.
        iz = rating(t, c["construction"], phases, r["sizeMm2"], r["runs"], b["site"])
        close(iz, r["izA"], "Iz", cid)
        if iz is not None and r["c1"] != ("pass" if iz >= rated else "fail"):
            fail(b, cid, f"C1 state: engine {r['c1']} with Iz {iz:.1f} A, In {rated} A")

    for cid, r in results.items():
        if cid not in own_pct:
            continue
        cum = total_drop(cid)
        close(cum, r["vdTotalPct"], "Vd total", cid)
        limit = pack.num(f"voltageDropLimitPct.{limit_key(elements[cables[cid]['to']]['kind'])}", b["overrides"])
        if cum is not None and r["c2"] != ("pass" if cum <= limit else "fail"):
            fail(b, cid, f"C2 state: engine {r['c2']} with {cum:.3f} % vs {limit} %")

    # Ik"max at each breaker (the board a feeder starts from), CableSizer method (10.8).
    tx = next(e for e in b["elements"] if e["kind"] == "transformer")
    sq = b["upstreamFaultMva"]
    zq = VN * VN / (sq * 1000)
    uk = tx["ukPct"] if tx["ukPct"] is not None else pack.uk(tx["kva"], tx["primaryV"])
    ur = tx["urPct"] if tx["urPct"] is not None else t.value("Ur", kVA=tx["kva"])
    if uk is None or ur is None:
        return  # engine blocks with E2301 (asked for uk / ur)
    base = VN * VN / (tx["kva"] * 1000) * 1000
    zt, rt = uk / 100 * base, ur / 100 * base
    z_at = {tx["id"]: (0.1 * 0.995 * zq + rt, 0.995 * zq + math.sqrt(zt * zt - rt * rt))}

    def z_of(eid):
        if eid not in z_at:
            c = into[eid]
            r = results[c["id"]]
            rf, xf = z_of(c["from"])
            n, a, length = r["runs"], r["sizeMm2"], r["lengthM"]
            rc = RHO[c["construction"]["conductor"]] * length / (a * n)
            xc = (0.1 if a < 120 else 0.09) * length / n
            z_at[eid] = (rf + rc, xf + xc)
        return z_at[eid]

    for cid, c in cables.items():
        r = results[cid]
        if r["ikMaxAtBreakerKa"] is None:
            continue
        rr, xx = z_of(c["from"])
        close(VN / (SQRT3 * math.hypot(rr, xx)), r["ikMaxAtBreakerKa"], 'Ik"max at breaker', cid)


def main():
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    root = Path(sys.argv[2])
    t = Tables(root / "docs/reference/cablesizer_lookup_rules.json")
    pack = Pack(root / "packages/rulepacks/dubai/v1.json")
    failures = []
    checked = 0

    def fail(b, cid, msg):
        failures.append(f"seed {b['seed']} {cid}: {msg}")

    for b in data:
        check_building(b, t, pack, fail)
        checked += sum(1 for r in b["results"] if r["status"] not in ("blocked", "awaiting-load"))
    blocked = sum(1 for b in data for r in b["results"] if r["status"] == "blocked")
    print(
        f"Independent checker: {len(data)} buildings, {checked} feeders recomputed in full, "
        f"{blocked} blocked by the engine on a missing table value (length, Ib and In compared)."
    )
    for f in failures[:50]:
        print("  MISMATCH", f)
    if failures:
        print(f"{len(failures)} mismatches.")
        sys.exit(1)
    print("All values agree.")


if __name__ == "__main__":
    main()
