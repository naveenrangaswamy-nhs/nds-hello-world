const renderedAtFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "medium",
  timeZone: "Europe/London",
});

export default function Home() {
  const renderedAt = new Date();

  return (
    <div className="nhsuk-grid-row">
      <div className="nhsuk-grid-column-two-thirds">
        <span className="nhsuk-caption-xl">Next.js and the NHS design system</span>
        <h1 className="nhsuk-heading-xl">Hello world</h1>

        <p className="nhsuk-body-l">
          This page is styled with NHS.UK frontend, the code behind the NHS design system.
          It uses the NHS header, footer, typography, colours, spacing and layout grid.
        </p>

        <div className="nhsuk-inset-text">
          <span className="nhsuk-u-visually-hidden">Information: </span>
          <p>
            Edit <code>app/page.tsx</code> to change this page. Styles come from{" "}
            <code>app/globals.scss</code>, which imports the design system.
          </p>
        </div>

        <h2 className="nhsuk-heading-l" id="about">
          About this app
        </h2>
        <p>The application is set up with:</p>
        <ul className="nhsuk-list nhsuk-list--bullet">
          <li>Next.js App Router with TypeScript</li>
          <li>NHS.UK frontend SCSS compiled through Sass</li>
          <li>NHS.UK frontend JavaScript initialised on the client</li>
          <li>NHS favicons, app icons and web manifest served from /assets</li>
          <li>A skip link, landmark roles and the NHS page title format</li>
        </ul>

        <div className="nhsuk-card">
          <div className="nhsuk-card__content">
            <h3 className="nhsuk-card__heading nhsuk-heading-m">
              <a
                className="nhsuk-card__link"
                href="https://service-manual.nhs.uk/design-system/components"
              >
                Browse the components
              </a>
            </h3>
            <p className="nhsuk-card__description">
              See every component in the NHS design system, with guidance on when and how to use
              each one.
            </p>
          </div>
        </div>

        <p className="nhsuk-body-s nhsuk-u-secondary-text-color">
          This page was rendered on the server at{" "}
          <time dateTime={renderedAt.toISOString()}>{renderedAtFormatter.format(renderedAt)}</time>.
          Refresh to see it change.
        </p>

        <a
          className="nhsuk-button"
          draggable="false"
          href="https://service-manual.nhs.uk/design-system"
          role="button"
        >
          Read the design system
        </a>
      </div>
    </div>
  );
}
