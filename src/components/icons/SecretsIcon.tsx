import type { JSX, SVGProps } from 'react'

export type SecretsIconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number
  title?: string
}

const SecretsIcon = ({ size = 20, title = 'Secrets icon', ...svgProps }: SecretsIconProps): JSX.Element => {
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
        d="M15.5 3C17.9853 3 20 5.01472 20 7.5C20 9.98528 17.9853 12 15.5 12C14.8518 12 14.2332 11.8682 13.6667 11.6304L10 15.2929V18.5C10 19.3284 9.32843 20 8.5 20H6.5C5.67157 20 5 19.3284 5 18.5V16.5C5 15.6716 5.67157 15 6.5 15H7V13.5C7 13.1022 7.15804 12.7206 7.43934 12.4393L11.1304 8.74821C10.8682 8.13319 10.7286 7.47411 10.7286 6.78571C10.7286 4.08875 12.8038 2 15.5 2V3ZM15.5 5C14.1193 5 13 6.11929 13 7.5C13 8.88071 14.1193 10 15.5 10C16.8807 10 18 8.88071 18 7.5C18 6.11929 16.8807 5 15.5 5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default SecretsIcon
