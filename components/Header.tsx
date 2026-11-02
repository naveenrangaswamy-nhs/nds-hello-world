import Link from "next/link";

export type NavigationItem = {
  href: string;
  text: string;
  current?: boolean;
};

type HeaderProps = {
  serviceName: string;
  navigation?: NavigationItem[];
};

export default function Header({ serviceName, navigation = [] }: HeaderProps) {
  return (
    <header className="nhsuk-header" data-module="nhsuk-header" role="banner">
      <div className="nhsuk-header__container nhsuk-width-container">
        <div className="nhsuk-header__service">
          <Link
            className="nhsuk-header__service-logo"
            href="/"
            aria-label={`NHS ${serviceName} homepage`}
          >
            <svg
              className="nhsuk-header__logo"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 200 80"
              height="40"
              width="100"
              focusable="false"
              role="img"
              aria-label="NHS"
            >
              <title>NHS</title>
              <path
                fill="currentcolor"
                d="M200 0v80H0V0h200Zm-27.5 5.5c-14.5 0-29 5-29 22 0 10.2 7.7 13.5 14.7 16.3l.7.3c5.4 2 10.1 3.9 10.1 8.4 0 6.5-8.5 7.5-14 7.5s-12.5-1.5-16-3.5L135 70c5.5 2 13.5 3.5 20 3.5 15.5 0 32-4.5 32-22.5 0-19.5-25.5-16.5-25.5-25.5 0-5.5 5.5-6.5 12.5-6.5a35 35 0 0 1 14.5 3l4-13.5c-4.5-2-12-3-20-3Zm-131 2h-22l-14 65H22l9-45h.5l13.5 45h21.5l14-65H64l-9 45h-.5l-13-45Zm63 0h-18l-13 65h17l6-28H117l-5.5 28H129l13.5-65H125L119.5 32h-20l5-24.5Z"
              />
            </svg>
            <span className="nhsuk-header__service-name">{serviceName}</span>
          </Link>
        </div>
      </div>

      {navigation.length > 0 && (
        <nav className="nhsuk-header__navigation" aria-label="Menu">
          <div className="nhsuk-header__navigation-container nhsuk-width-container">
            <ul className="nhsuk-header__navigation-list">
              {navigation.map((item) => (
                <li
                  key={item.href}
                  className={`nhsuk-header__navigation-item${
                    item.current ? " nhsuk-header__navigation-item--current" : ""
                  }`}
                >
                  <Link
                    className="nhsuk-header__navigation-link"
                    href={item.href}
                    aria-current={item.current ? "page" : undefined}
                  >
                    {item.current ? (
                      <strong className="nhsuk-header__navigation-item-current-fallback">
                        {item.text}
                      </strong>
                    ) : (
                      item.text
                    )}
                  </Link>
                </li>
              ))}
              <li className="nhsuk-header__menu" hidden>
                <button
                  className="nhsuk-header__menu-toggle nhsuk-header__navigation-link"
                  id="toggle-menu"
                  aria-expanded="false"
                >
                  <span className="nhsuk-u-visually-hidden">Browse </span>More
                </button>
              </li>
            </ul>
          </div>
        </nav>
      )}
    </header>
  );
}
