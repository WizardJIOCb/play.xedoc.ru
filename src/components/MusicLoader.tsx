export function MusicLoader() {
  return (
    <div className="app-loader" role="status" aria-live="polite" aria-label="Загружаем музыку">
      <div className="app-loader__halo" aria-hidden="true" />
      <div className="app-loader__content">
        <div className="app-loader__visual" aria-hidden="true">
          <div className="app-loader__vinyl"><span>X</span></div>
        </div>
        <div className="app-loader__copy">
          <span>XEDOC PLAY</span>
          <strong>Ловим нужную волну</strong>
          <small>Загружаем музыку<span className="app-loader__dots" aria-hidden="true"><i /><i /><i /></span></small>
        </div>
        <div className="app-loader__progress" aria-hidden="true"><i /></div>
      </div>
    </div>
  )
}
