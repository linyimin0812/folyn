import { useToastStore } from '@/store/toastStore';

// ponytail: renders the front of the toast queue, reusing .sw-toast CSS.
// Auto-dismiss handled by store; action button dismisses + runs.
export function ToastHost() {
  const toast = useToastStore((s) => s.queue[0] ?? null);
  const dismiss = useToastStore((s) => s.dismiss);

  if (!toast) return null;

  return (
    <div className={`sw-toast show`}>
      <span className="sw-toast-msg">{toast.message}</span>
      {toast.action && (
        <button
          className="sw-toast-action"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
