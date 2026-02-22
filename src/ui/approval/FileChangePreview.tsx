interface FileChangePreviewProps {
  params: Record<string, unknown>;
}

function renderJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function FileChangePreview({ params }: FileChangePreviewProps) {
  const changes = params.changes ?? params.item ?? params;

  return (
    <section className="file-change-preview" aria-label="file change preview">
      <h3>Proposed file changes</h3>
      <pre>{renderJson(changes)}</pre>
    </section>
  );
}

