import type { BusbarMaker } from '@neuromep/shared';
import type { BusbarRow, RulePack } from '@neuromep/rulepacks';

/**
 * Busbar trunking (manager's answers 3 Nov 2026, "Busbar Data.xlsx"): ratings and R / X of the
 * project's busbar manufacturer. Resistance at temperature R(T) = R20 x (1 + alpha (T - 20)); the
 * voltage drop uses R at 95 deg C: dV = k x sqrt3 x (R cos phi + X sin phi) x Ib x L, with
 * k = 1 for a feeder (load at the end) and k = (n + 1) / 2n for a riser with n tap-offs.
 */

export interface BusbarChoice extends BusbarRow {
  maker: BusbarMaker;
  /** Resistance at the operating temperature (95 deg C), mOhm/m. */
  rHotMohmM: number;
}

export function busbarChoices(pack: RulePack, maker: BusbarMaker): BusbarChoice[] {
  const { alpha, operatingC } = pack.busbars;
  return [...pack.busbars.makers[maker]]
    .sort((a, b) => a.ratingA - b.ratingA)
    .map((row) => ({
      ...row,
      maker,
      rHotMohmM: row.r20MohmM * (1 + alpha * (operatingC - 20)),
    }));
}

/** Load distribution factor k: 1 for one load at the end, (n + 1) / 2n for n tap-offs. */
export const distributionFactor = (tapOffs: number) =>
  tapOffs > 1 ? (tapOffs + 1) / (2 * tapOffs) : 1;

/** Voltage drop of a busbar run, % of 400 V. */
export function busbarDropPct(
  b: BusbarChoice,
  ibA: number,
  pf: number,
  lengthM: number,
  k = 1,
): number {
  const sin = Math.sin(Math.acos(pf));
  const volts = (k * Math.sqrt(3) * (b.rHotMohmM * pf + b.xMohmM * sin) * ibA * lengthM) / 1000;
  return (volts / 400) * 100;
}
