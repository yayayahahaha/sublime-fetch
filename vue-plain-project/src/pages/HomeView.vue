<template>
  <h1>
    This is <span>{{ $options.name }}</span> Page
  </h1>
  <router-link to="/about">about</router-link>
</template>

<script>
export default {
  name: 'HomeView',
}
</script>

<style lang="scss" scoped>
h1 {
  text-decoration: underline;

  span {
    text-decoration: line-through;
  }
}
</style>
