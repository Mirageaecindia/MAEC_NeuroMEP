/** Marks a layout that shows sample data only (WBS 1.2.1). */
export function PreviewBanner(props: { builtIn: string }) {
  return (
    <div className="banner banner-info preview-banner" role="note">
      <strong>Layout preview with sample data.</strong> Not connected to this project yet - built in{' '}
      {props.builtIn}.
    </div>
  );
}
