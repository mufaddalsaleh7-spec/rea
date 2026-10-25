/** Anchor that navigates the hash router without a page load. */

export function Link({ to, className, children, ...rest }) {
  return (
    <a
      href={`#/${String(to).replace(/^\//, "")}`}
      className={className}
      {...rest}
    >
      {children}
    </a>
  );
}
