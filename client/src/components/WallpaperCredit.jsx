// "Photo by Jane Doe on Unsplash", linked: what Unsplash, Pexels and the Creative
// Commons licences ask for wherever a picture is shown.
export function WallpaperCredit({ image }) {
  if (!image) return null
  const link = (href, label) => (href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : label)
  return (
    <span className="wp-credit">
      {image.author && <>Photo by {link(image.authorUrl, image.author)} on </>}
      {link(image.sourceUrl, image.providerName)}
      {image.license && ` · ${image.license}`}
    </span>
  )
}
