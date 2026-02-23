import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RotateCcw } from "lucide-react";

interface WorkspacePickerProps {
  value: string;
  defaultPath: string | null;
  onChange: (nextValue: string) => void;
  onBlur: () => void;
  onBrowseSelect: (nextValue: string) => void;
  onUseDefault: () => void;
}

export function WorkspacePicker({
  value,
  defaultPath,
  onChange,
  onBlur,
  onBrowseSelect,
  onUseDefault,
}: WorkspacePickerProps) {
  async function handleBrowseWorkspace(): Promise<void> {
    try {
      const activePath = value.trim().length > 0 ? value.trim() : (defaultPath ?? undefined);
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: activePath,
      });
      if (!picked) {
        return;
      }
      const selectedPath = Array.isArray(picked) ? picked[0] : picked;
      if (typeof selectedPath !== "string") {
        return;
      }
      const normalizedPath = selectedPath.trim();
      if (normalizedPath.length === 0) {
        return;
      }
      onBrowseSelect(normalizedPath);
    } catch (error) {
      console.warn("workspace picker failed", error);
    }
  }

  return (
    <div className="workspace-picker">
      <label htmlFor="workspacePath">Workspace path</label>
      <div className="workspace-picker-input-row">
        <input
          id="workspacePath"
          type="text"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onBlur}
          placeholder={defaultPath ?? "Loading default workspace path..."}
        />
        <button
          type="button"
          className="workspace-picker-browse"
          onClick={() => void handleBrowseWorkspace()}
          aria-label="Browse workspace folder"
          title="Browse workspace folder"
        >
          <FolderOpen size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="workspace-picker-use-default"
          onClick={onUseDefault}
          disabled={!defaultPath}
          aria-label="Use default workspace"
          title="Use default workspace"
        >
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
