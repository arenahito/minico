interface WorkspacePickerProps {
  value: string;
  defaultPath: string | null;
  onChange: (nextValue: string) => void;
  onUseDefault: () => void;
}

export function WorkspacePicker({
  value,
  defaultPath,
  onChange,
  onUseDefault,
}: WorkspacePickerProps) {
  return (
    <div className="workspace-picker">
      <label htmlFor="workspacePath">Workspace path</label>
      <input
        id="workspacePath"
        type="text"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={defaultPath ?? "Loading default workspace path..."}
      />
      <button type="button" onClick={onUseDefault} disabled={!defaultPath}>
        Use default workspace
      </button>
      {defaultPath ? (
        <p>
          Default workspace: <strong>{defaultPath}</strong>
        </p>
      ) : null}
    </div>
  );
}
