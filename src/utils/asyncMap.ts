const asyncMap = async <T = any, U = any>(list: T[], run: (arg: T, index: number, list: T[]) => Promise<U>) => {
  const task: U[] = []
  for (let index = 0; index < list.length; index++) {
    task.push(await run(list[index], index, list))
  }
  return task
}

export default asyncMap
