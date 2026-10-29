import {
  DisciplineSchema,
  flagBlockers,
  floorStatus,
  type Discipline,
  type Floor,
  type FloorStatus,
  type Project,
} from '@neuromep/shared';
import { Modal } from '../../components/fields';
import { StatusMark, type StatusIcon } from '../../layout/icons';

export const STATUS_ICON: Record<FloorStatus, StatusIcon> = {
  flagged: 'flag',
  'in-progress': 'pill',
  'not-opened': 'cross',
};
const LABEL: Record<Discipline, string> = {
  electrical: 'Electrical',
  mechanical: 'Mechanical',
  phe: 'PHE',
};

/**
 * Toolbar Status (A-08): the floor's status per discipline. An engineer flags their layer done
 * once every component of it has a source (no E1801); the flag saves and locks the layer on this
 * floor. Only the Technical Lead reopens a flagged floor.
 */
export function FloorStatusDialog(props: {
  floor: Floor;
  project: Project;
  layers: Discipline[];
  isLead: boolean;
  onFlag: (d: Discipline) => void;
  onReopen: (d: Discipline) => void;
  onClose: () => void;
}) {
  const { floor, project } = props;
  return (
    <Modal
      title={`${floor.name} status`}
      onClose={props.onClose}
      actions={
        <button className="btn" onClick={props.onClose}>
          Close
        </button>
      }
    >
      <p className="muted">
        Flag a floor when your layer is done: it is saved and locked, and only the Technical Lead
        can reopen it.
      </p>
      <table className="loads-table" aria-label="Floor status">
        <tbody>
          {DisciplineSchema.options.map((d) => {
            const status = floorStatus(project.model, floor.id, d);
            const blockers =
              status === 'flagged'
                ? []
                : flagBlockers(project.model, project.building.floors, floor.id, d);
            return (
              <tr key={d}>
                <th scope="row">{LABEL[d]}</th>
                <td>
                  <StatusMark status={STATUS_ICON[status]} size={16} />
                </td>
                <td>
                  {status === 'flagged' ? (
                    props.isLead && (
                      <button className="btn" onClick={() => props.onReopen(d)}>
                        Reopen {LABEL[d]}
                      </button>
                    )
                  ) : props.layers.includes(d) ? (
                    <>
                      <button
                        className="btn btn-primary"
                        disabled={blockers.length > 0}
                        onClick={() => props.onFlag(d)}
                      >
                        Flag {LABEL[d]} done
                      </button>
                      {blockers.length > 0 && (
                        <ul className="field-hint">
                          {blockers.map((b) => (
                            <li key={b.elementId}>
                              {b.message} ({b.code})
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
