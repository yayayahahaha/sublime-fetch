import { h, render, defineComponent } from 'vue'
import { uuid } from '@/utils.js'

export default {
  install: (app) => {
    app.config.globalProperties.$openDialog = async function (dComponent, props) {
      const id = `open-dialog-container-${uuid()}`

      return new Promise((resolve) => {
        const OpenDialogComponent = defineComponent({
          name: 'OpenDialogComponent',

          data() {
            return {
              visible: true,
            }
          },

          render() {
            return this.visible
              ? h(dComponent, {
                  ...props,
                  'onDialog:done': (event) => {
                    this.visible = false

                    resolve(event ?? null)
                  },
                })
              : null
          },
        })

        const container = document.createElement('div')
        container.setAttribute('id', id)
        document.body.appendChild(container)

        const vnode = h(OpenDialogComponent)
        vnode.appContext = app._context
        render(vnode, container)
      }).finally(() => {
        const container = document.querySelector(`#${id}`)
        if (container != null) {
          render(null, container)
          document.body.removeChild(container)
        }
      })
    }
  },
}
