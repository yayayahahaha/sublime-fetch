<template>
  <button @click="handleClick">My Button</button>
</template>

<script>
export default {
  name: 'HelloWorld',

  emits: ['dialog:done'],

  created() {
    console.log(this.$store.state.app.count)
  },

  methods: {
    handleClick() {
      this.$emit('dialog:done')
    },
  },
}
</script>
