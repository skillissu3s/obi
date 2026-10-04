// "Photo by Jane Doe on Unsplash", linked: what Unsplash, Pexels and the Creative
// Commons licences ask for wherever a picture is shown.
export function WallpaperCredit({ image }) {
  if (!image) return null
  const link = (href, label) => (href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : label)
  return (
    <span className="wp-credit" title={`${image.author ? `Photo by ${image.author} on ` : ''}${image.providerName}${image.license ? ` · ${image.license}` : ''}`}>
      {image.author && (
        <>
          Photo by <span className="wp-author">{link(image.authorUrl, image.author)}</span> on{' '}
        </>
      )}
      {link(image.sourceUrl, image.providerName)}
      {image.license && ` · ${image.license}`}
    </span>
  )
}
