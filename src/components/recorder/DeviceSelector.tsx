import { useRecorderStore } from "../../store/recorderStore";
import { useRecorder } from "../../hooks/useRecorder";

export function DeviceSelector() {
  const devices = useRecorderStore((s) => s.devices);
  const selectedDeviceId = useRecorderStore((s) => s.selectedDeviceId);
  const { selectDevice, refreshDevices } = useRecorder();

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedDeviceId || ""}
        onChange={(e) => {
          if (e.target.value) selectDevice(e.target.value);
        }}
        className="bg-surface-raised border border-surface-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent min-w-[200px]"
      >
        <option value="" disabled>
          Select input device...
        </option>
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.name}
            {device.is_default ? " (default)" : ""}
            {" · "}
            {device.max_channels}ch
          </option>
        ))}
      </select>
      <button
        onClick={refreshDevices}
        className="text-gray-400 hover:text-white text-sm px-1.5 py-1.5"
        title="Refresh devices"
      >
        &#x21bb;
      </button>
    </div>
  );
}
