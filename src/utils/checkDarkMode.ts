const checkDarkMode = () => {
  const colorScheme = document.documentElement.style.getPropertyValue('color-scheme').trim()

  if (colorScheme === 'dark') {
    return true // Prefer the website's color-scheme property value
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches // Otherwise, check the system theme
}

export default checkDarkMode
