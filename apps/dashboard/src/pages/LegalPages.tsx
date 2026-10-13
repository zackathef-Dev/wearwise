import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { DOCS, docBySlug, fill, orgMissing, type LegalDoc } from '@wearwise/legal';
import { Logo } from '../components/AppShell';
import { Alert } from '../components/ui';

/* The legal and compliance documents (packages/legal), public: the sign-in page and
   every footer link here, and so does the app. Same text and version as the app. */

const effective = (v: string) => {
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
};

function LegalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="legal-shell">
      <header className="legal-top">
        <Link to="/" aria-label="WearWise home"><Logo /></Link>
        <Link to="/legal" className="small">All documents</Link>
      </header>
      <main className="legal-main" id="main">{children}</main>
      <LegalFooter />
    </div>
  );
}

function Draft() {
  return orgMissing().length > 0 ? (
    <Alert kind="warning" title="Draft">
      These documents are being finalised. Some details, shown in [brackets], are still to be filled in.
    </Alert>
  ) : null;
}

export function LegalIndexPage() {
  return (
    <LegalFrame>
      <h1>Legal &amp; privacy</h1>
      <Draft />
      <ul className="legal-index">
        {DOCS.map((d) => (
          <li key={d.slug}>
            <Link to={`/legal/${d.slug}`}><strong>{d.title}</strong></Link>
            <span className="small muted">{fill(d.summary)}</span>
          </li>
        ))}
      </ul>
    </LegalFrame>
  );
}

export function LegalDocPage() {
  const { slug } = useParams();
  const doc = docBySlug(slug ?? '');
  return (
    <LegalFrame>
      {doc ? <LegalDocument doc={doc} /> : (
        <>
          <h1>Not found</h1>
          <p>There’s no document at this address. <Link to="/legal">See all documents</Link>.</p>
        </>
      )}
    </LegalFrame>
  );
}

function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal-doc">
      <h1>{doc.title}</h1>
      <p className="small muted">Effective {effective(doc.version)}</p>
      <Draft />
      <p className="legal-summary">{fill(doc.summary)}</p>
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <h2>{fill(s.heading)}</h2>
          {s.blocks.map((b, i) => (
            typeof b === 'string' ? <p key={i}>{fill(b)}</p>
              : 'list' in b ? <ul key={i}>{b.list.map((item, j) => <li key={j}>{fill(item)}</li>)}</ul>
              : <div key={i} className="legal-note">{fill(b.note)}</div>
          ))}
        </section>
      ))}
    </article>
  );
}

/** Links to the main documents, for footers. */
export function LegalFooter() {
  return (
    <nav className="legal-footer small" aria-label="Legal">
      <Link to="/legal/terms">Terms</Link>
      <Link to="/legal/privacy">Privacy</Link>
      <Link to="/legal/collection-notice">Collection notice</Link>
      <Link to="/legal/health-safety">Health &amp; safety</Link>
      <Link to="/legal/accessibility">Accessibility</Link>
      <Link to="/legal">All documents</Link>
    </nav>
  );
}
