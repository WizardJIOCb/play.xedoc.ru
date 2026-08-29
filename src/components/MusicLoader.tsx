const equalizerBars = [10, 24, 17, 31, 21, 27, 13]

export function MusicLoader() {
  return (
    <div className="app-loader" role="status" aria-live="polite" aria-label="Загружаем музыку">
      <div className="app-loader__halo" aria-hidden="true" />
      <div className="app-loader__content">
        <div className="app-loader__visual" aria-hidden="true">
          <div className="app-loader__vinyl"><span>X</span></div>
          <div className="app-loader__tonearm"><i /></div>
          <div className="app-loader__equalizer">
            {equalizerBars.map((height, index) => <i key={height} style={{ '--bar-height': `${height}px`, '--bar-delay': `${index * -0.12}s` } as React.CSSProperties} />)}
          </div>
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
