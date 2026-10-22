import React from 'react';

/**
 * A labelled form control. The error and hint stay outside the <label> so the
 * control's accessible name never picks up validation text.
 */
export default function Field({ label, children, className = '', error = '', hint = '' }) {
  return (
    <div className={`eia-field ${className}`.trim()}>
      <label>
        <span>{label}</span>
        {children}
      </label>
      {hint ? <span className="eia-field-hint">{hint}</span> : null}
      {error ? <span className="eia-field-error">{error}</span> : null}
    </div>
  );
}
