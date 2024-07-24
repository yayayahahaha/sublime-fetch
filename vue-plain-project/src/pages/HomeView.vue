<template>
  <h1>
    This is <span>{{ $options.name }}</span> Page
  </h1>
  <div class="mt-4"></div>
  <router-link to="/about">about</router-link>
  <div class="mt-4"></div>
  <button @click="$openDialog(ButtonExample)">Click Me!</button>
</template>

<script>
export default {
  name: 'HomeView',
}
</script>

<script setup>
import ButtonExample from '@/components/ButtonExample.vue'
</script>

<style lang="scss" scoped>
h1 {
  text-decoration: underline;

  span {
    text-decoration: line-through;
  }
}
</style>
