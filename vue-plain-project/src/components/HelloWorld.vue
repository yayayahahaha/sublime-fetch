<template>
  <div>HelloWorld</div>
</template>

<script>
export default {
  name: 'HelloWorld',

  created() {
    console.log(this.$store.state.app.count)
  },
}
</script>
