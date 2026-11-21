export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brandLogo ${compact ? 'compact' : ''}`} aria-label="Diversões Veneza">
      <div className="wheelMark" aria-hidden="true">
        <span className="wheelRing" />
        <span className="wheelHub" />
        <span className="wheelLine l1" /><span className="wheelLine l2" /><span className="wheelLine l3" /><span className="wheelLine l4" />
      </div>
      <div className="brandWords"><small>DIVERSÕES</small><strong>VENEZA</strong></div>
    </div>
  );
}
