import { ButtonLink, EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="card">
      <EmptyState icon="info" title="Page not found" action={<ButtonLink to="/" icon="arrow-left">Back to the start</ButtonLink>}>
        There’s nothing at this address.
      </EmptyState>
    </div>
  );
}
