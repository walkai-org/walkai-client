import type { JSX, SVGProps } from 'react'

export type VolumesIconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number
  title?: string
}

const VolumesIcon = ({ size = 20, title = 'Volumes icon', ...svgProps }: VolumesIconProps): JSX.Element => {
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
        d="M4 8.5C4 6.01472 8.47715 4 14 4C19.5228 4 24 6.01472 24 8.5C24 10.9853 19.5228 13 14 13C8.47715 13 4 10.9853 4 8.5ZM4 12.5C4 10.828 5.89697 9.3566 8.75 8.55101C9.81046 8.24963 10.9489 8.02691 12.1223 7.89644C12.7276 7.2998 13.5381 7 14 7C14.4619 7 15.2724 7.2998 15.8777 7.89644C17.0511 8.02691 18.1895 8.24963 19.25 8.55101C22.103 9.3566 24 10.828 24 12.5C24 14.9853 19.5228 17 14 17C8.47715 17 4 14.9853 4 12.5ZM4 16.5C4 14.828 5.89697 13.3566 8.75 12.551C9.81046 12.2496 10.9489 12.0269 12.1223 11.8964C12.7276 11.2998 13.5381 11 14 11C14.4619 11 15.2724 11.2998 15.8777 11.8964C17.0511 12.0269 18.1895 12.2496 19.25 12.551C22.103 13.3566 24 14.828 24 16.5C24 18.9853 19.5228 21 14 21C8.47715 21 4 18.9853 4 16.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default VolumesIcon
