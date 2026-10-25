import { AlertCircle, CheckCircle2, Shield, XCircle } from 'lucide-react';
import styles from './ProblemSolution.module.css';

interface ComparisonRow {
  dimension: string;
  legacy: string;
  tycode: string;
}

const COMPARISONS: ComparisonRow[] = [
  {
    dimension: 'Data Privacy & Exfiltration',
    legacy: 'Streams your proprietary code, ASTs, and file trees to multitenant SaaS servers.',
    tycode: 'Zero-Telemetry Guarantee. All AST parsing, repo indexing, and terminal execution stay on your local hardware.'
  },
  {
    dimension: 'Pricing & Cost Scaling',
    legacy: '$20/month subscription markups with artificial rate limits and surprise credit expirations.',
    tycode: 'Bring-Your-Own-Key (BYOK). Pay wholesale model rates directly to providers, or run 100% free with local LLMs.'
  },
  {
    dimension: 'Credential Security',
    legacy: 'Plaintext config files and browser cookies vulnerable to credential harvesters.',
    tycode: 'safeStorage Hardware Vault. Keys are cryptographically sealed by Windows DPAPI, macOS Keychain, and Linux Secret Service.'
  },
  {
    dimension: 'Model Availability',
    legacy: 'Hard vendor lock-in; unannounced model downgrades and pipeline-breaking cloud outages.',
    tycode: 'Omni-Orchestrator. Health-aware dynamic failover automatically pivots across 100+ models without dropping context.'
  },
  {
    dimension: 'Network Autonomy',
    legacy: 'Ceases functioning the moment internet connectivity drops or cloud APIs hit throttling.',
    tycode: 'Air-Gapped Capable. Runs completely offline with local Ollama, vLLM, or private VPC gateway endpoints.'
  }
];

export default function ProblemSolution() {
  return (
    <section className={styles.section} id="problem-solution" aria-labelledby="problem-heading">
      <div className={styles.header}>
        <span className={styles.eyebrow}>THE STATE OF AI IDES</span>
        <h2 id="problem-heading">Stop Renting Your Intelligence. Own Your Development Stack.</h2>
        <p className={styles.subhead}>
          Legacy cloud-locked editors force a dangerous trade-off between engineering speed and data sovereignty. Ty-Code eliminates the compromise.
        </p>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colDim}>Dimension</th>
              <th className={styles.colLegacy}>
                <span className={styles.headWrap}>
                  <AlertCircle size={16} aria-hidden="true" /> Legacy Cloud-Locked IDEs
                </span>
              </th>
              <th className={styles.colTycode}>
                <span className={styles.headWrap}>
                  <Shield size={16} aria-hidden="true" /> Ty-Code Local Architecture
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISONS.map((row, idx) => (
              <tr key={idx}>
                <td className={styles.dimCell}>
                  <strong>{row.dimension}</strong>
                </td>
                <td className={styles.legacyCell}>
                  <XCircle size={16} className={styles.crossIcon} aria-hidden="true" />
                  <span>{row.legacy}</span>
                </td>
                <td className={styles.tycodeCell}>
                  <CheckCircle2 size={16} className={styles.checkIcon} aria-hidden="true" />
                  <span>{row.tycode}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
