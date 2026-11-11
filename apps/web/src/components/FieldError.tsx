/** A field's validation message, announced to screen readers. Renders nothing when null. */
export function FieldError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
