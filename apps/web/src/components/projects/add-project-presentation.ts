export interface SelectedDirectoryPresentation {
  name: string
  path: string
}

export function createSelectedDirectoryPresentation(
  path: string,
): SelectedDirectoryPresentation {
  const withoutTrailingSeparators = path.replace(/[\\/]+$/u, '')
  const segments = withoutTrailingSeparators.split(/[\\/]/u)
  const name = segments.at(-1) || withoutTrailingSeparators || path

  return { name, path }
}

export function projectAddActionLabel(canPickDirectory: boolean): string {
  return canPickDirectory ? '选择文件夹' : '添加项目'
}
