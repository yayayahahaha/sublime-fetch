import cliProgress from 'cli-progress'

// https://github.com/npkgz/cli-progress?tab=readme-ov-file
export function loadingBar(total) {
  const instance = new cliProgress.SingleBar({
    format: (barInfo, currentInfo, params) => {
      const { barsize: defaultBarsize } = barInfo
      const barsize = Math.max(defaultBarsize, 50)

      const { progress, total, value } = currentInfo
      const { fileName } = params

      const persent = (progress * 100).toFixed(2)
      const barImgStr = [...Array(barsize)]
        .map((_, index) => {
          if ((barsize * persent) / 100 >= index + 1) return '█'
          return '░'
        })
        .flat()
        .join('')

      return `${barImgStr} | ${persent}% | ${value}/${total} | 下載中的檔案: ${fileName}`
    }
  })

  instance.start(total, 0)

  return {
    instance,
    total,
    progress: 0,
    update(newProgress) {
      this.instance.update(newProgress)
    },
    stop() {
      this.instance.stop()
    },
    increment(fileName) {
      this.instance.increment(1, { fileName })
    }
  }
}

export function loadingSpinner() {
  const timer = (function () {
    // const P = ['\\', '|', '/', '-']
    // const P = ['Loading.', 'Loading..', 'Loading...', 'Loading..', 'Loading.']
    // const P = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
    // const P = ['◢', '◣', '◤', '◥']
    // const P = ['◰', '◳', '◲', '◱']
    // const P = ['◴', '◷', '◶', '◵']
    const P = ['◐', '◓', '◑', '◒']

    let x = 0
    return setInterval(function () {
      process.stdout.write(`\rLoading... ${P[x++ % P.length]}`)
    }, 50)
  })()

  return {
    instance: timer,
    stop() {
      clearInterval(this.instance)
      process.stdout.clearLine()
      process.stdout.cursorTo(0)
    }
  }
}
