export default function Button({ icon, children, onClick, className }) {
  return (
    <button
      className={`rounded-full px-4 py-3 flex items-center gap-2 transition-all select-none active:translate-y-[1px] ${
        className || "btn-muted"
      }`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
