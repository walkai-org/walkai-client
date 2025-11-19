import type { JSX, SVGProps } from 'react'

export type ProfileIconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number
  title?: string
}

const ProfileIcon = ({ size = 20, title = 'Profile icon', ...svgProps }: ProfileIconProps): JSX.Element => {
  const accessibilityProps = title
    ? ({ role: 'img' } as const)
    : ({ role: 'presentation', 'aria-hidden': true } as const)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...accessibilityProps}
      {...svgProps}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M12 13.5C8.96243 13.5 6.5 15.9624 6.5 19V19.75C6.5 20.4404 7.05964 21 7.75 21H16.25C16.9404 21 17.5 20.4404 17.5 19.75V19C17.5 15.9624 15.0376 13.5 12 13.5Z"
        fill="currentColor"
        opacity="0.8"
      />
      <path
        d="M12 12C14.4853 12 16.5 9.98528 16.5 7.5C16.5 5.01472 14.4853 3 12 3C9.51472 3 7.5 5.01472 7.5 7.5C7.5 9.98528 9.51472 12 12 12Z"
        fill="currentColor"
      />
      <path
        d="M20 19C20 14.5817 16.4183 11 12 11C7.58172 11 4 14.5817 4 19"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  )
}

export default ProfileIcon

