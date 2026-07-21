export default function TerrainBar({ r }) {
  if (r.pct_beginner == null) return null;
  return (
    <div>
      <div className="terrain-bar" role="img"
        aria-label={`Terrain: ${r.pct_beginner}% beginner, ${r.pct_intermediate}% intermediate, ${r.pct_expert}% expert`}>
        <span className="beg" style={{ width: `${r.pct_beginner}%` }} />
        <span className="int" style={{ width: `${r.pct_intermediate}%` }} />
        <span className="exp" style={{ width: `${r.pct_expert}%` }} />
      </div>
      <p className="small">
        {r.pct_beginner}% beginner · {r.pct_intermediate}% intermediate · {r.pct_expert}% expert
      </p>
    </div>
  );
}
