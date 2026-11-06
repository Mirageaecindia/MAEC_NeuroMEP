import type { GeneratorAnalysis, GeneratorFactor, GeneratorRow } from '@neuromep/shared';
import { useState } from 'react';
import { NumberInput } from '../../components/fields';
import { CATEGORY_LABEL, GEN_HEADS, genSummary, kw } from './generatorFiles';

type Patch = Partial<Omit<GeneratorFactor, 'elementId'>>;
const CASES = [
  ['normal', 'Normal'],
  ['powerFailure', 'Case-1'],
  ['fire', 'Case-2'],
] as const;

/**
 * Generator Load Analysis preview (briefing page 8): the one editable report - the engineer types
 * the three demand factors and a remark per load; loads still at the starting 1.0 are highlighted.
 */
export function GeneratorAnalysisSheet(props: {
  analysis: GeneratorAnalysis;
  project: string;
  readOnly: boolean;
  onChange: (elementId: string, patch: Patch, start: GeneratorRow['factors']) => void;
}) {
  const g = props.analysis;
  const unedited = g.groups.flatMap((x) => x.rows).filter((r) => !r.edited).length;
  return (
    <div className="calc-sheet gen-sheet" aria-label={`Generator load analysis ${g.tag}`}>
      <p className="calc-sheet-title">
        <strong>LOAD ANALYSIS - GENERATORS - {g.tag}</strong> · {props.project}
      </p>
      {unedited > 0 && (
        <p className="sample-note">
          {unedited} load{unedited === 1 ? '' : 's'} still at the starting factors (highlighted:
          1.0, fire 1.0 for FLS and 0 for the others):
          {props.readOnly ? ' the electrical engineer enters' : ' enter'} the demand factors for
          normal operation, power failure and fire.
        </p>
      )}
      <div className="calc-sheet-scroll">
        <table>
          <thead>
            <tr>
              {GEN_HEADS.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.groups.map((group) => [
              <tr key={`${group.from}>${group.to}`} className="gen-group">
                <td>{group.from}</td>
                <td colSpan={GEN_HEADS.length - 1}>{group.to}</td>
              </tr>,
              ...group.rows.map((r) => (
                <tr key={r.elementId} className={r.edited ? undefined : 'gen-unedited'}>
                  <td>{r.from}</td>
                  <td>{r.to}</td>
                  <td className={r.category === 'fls' ? 'gen-fls' : undefined}>
                    {CATEGORY_LABEL[r.category]}
                  </td>
                  <td>{kw(r.kw.L1)}</td>
                  <td>{kw(r.kw.L2)}</td>
                  <td>{kw(r.kw.L3)}</td>
                  <td>{kw(r.totalKw)}</td>
                  {CASES.map(([key, label]) => (
                    <td key={key}>
                      <FactorInput
                        label={`${label} factor ${r.to}`}
                        value={r.factors[key]}
                        disabled={props.readOnly}
                        onCommit={(v) => props.onChange(r.elementId, { [key]: v }, r.factors)}
                      />
                    </td>
                  ))}
                  <td>{kw(r.normalKw)}</td>
                  <td>{kw(r.powerFailureKw)}</td>
                  <td>{kw(r.fireKw)}</td>
                  <td>
                    <RemarkInput
                      label={`Remarks ${r.to}`}
                      value={r.remarks}
                      disabled={props.readOnly}
                      onCommit={(remarks) => props.onChange(r.elementId, { remarks }, r.factors)}
                    />
                  </td>
                </tr>
              )),
            ])}
            {g.groups.length === 0 && (
              <tr>
                <td colSpan={GEN_HEADS.length}>
                  No loads downstream of {g.tag} yet: connect it to an ATS or a panel in Floor
                  Setup.
                </td>
              </tr>
            )}
            <tr className="gen-total">
              <td colSpan={6}>TOTAL</td>
              <td>{kw(g.totals.connectedKw)}</td>
              <td colSpan={3} />
              <td>{kw(g.totals.normalKw)}</td>
              <td>{kw(g.totals.powerFailureKw)}</td>
              <td>{kw(g.totals.fireKw)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <table className="gen-summary" aria-label={`Generator rating ${g.tag}`}>
        <tbody>
          {genSummary(g).map(([label, value, note], i) => (
            <tr key={label} className={i === 4 && g.adequate === false ? 'gen-short' : undefined}>
              <th>{label}</th>
              <td>{value}</td>
              <td>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A demand factor 0 - 1; a value outside is shown red and not kept. */
function FactorInput(props: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [bad, setBad] = useState(false);
  return (
    <NumberInput
      ariaLabel={props.label}
      className="gen-input"
      value={props.value}
      commit="blur"
      disabled={props.disabled}
      invalid={bad}
      onChange={(v) => {
        const ok = v !== null && v >= 0 && v <= 1;
        setBad(!ok);
        if (ok) props.onCommit(v);
      }}
    />
  );
}

function RemarkInput(props: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(props.value);
  return (
    <input
      aria-label={props.label}
      className="gen-input gen-remark"
      value={text}
      maxLength={200}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== props.value && props.onCommit(text)}
    />
  );
}
