import { useScheduleStore } from '@/store/scheduleStore';

export function SwToast() {
  const msg = useScheduleStore((s) => s.toastMsg);
  const action = useScheduleStore((s) => s.toastAction);

  return (
    <div className={`sw-toast ${msg ? 'show' : ''}`}>
      <span className="sw-toast-msg">{msg}</span>
      {action && (
        <button
          className="sw-toast-action"
          onClick={() => {
            action.run();
            useScheduleStore.setState({ toastMsg: '', toastAction: null });
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
