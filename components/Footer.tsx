type FooterLink = { href: string; text: string };

type FooterColumn = {
  heading: string;
  items: FooterLink[];
};

type FooterProps = {
  navigation?: FooterColumn[];
  meta?: FooterLink[];
  copyright?: string;
};

function FooterList({ items }: { items: FooterLink[] }) {
  return (
    <ul className="nhsuk-footer__list">
      {items.map((item) => (
        <li key={item.href} className="nhsuk-footer__list-item">
          <a className="nhsuk-footer__list-item-link" href={item.href}>
            {item.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Footer({
  navigation = [],
  meta = [],
  copyright = "© NHS England",
}: FooterProps) {
  return (
    <footer className="nhsuk-footer" role="contentinfo">
      <div className="nhsuk-width-container">
        {navigation.length > 0 && (
          <div className="nhsuk-footer__navigation nhsuk-grid-row">
            {navigation.map((column) => (
              <div key={column.heading} className="nhsuk-grid-column-one-quarter">
                <h2 className="nhsuk-footer__heading nhsuk-heading-s">{column.heading}</h2>
                <FooterList items={column.items} />
              </div>
            ))}
          </div>
        )}
        <div className="nhsuk-footer__meta">
          {meta.length > 0 && (
            <>
              <h2 className="nhsuk-u-visually-hidden">Support links</h2>
              <FooterList items={meta} />
            </>
          )}
          <p className="nhsuk-body-s">{copyright}</p>
        </div>
      </div>
    </footer>
  );
}
