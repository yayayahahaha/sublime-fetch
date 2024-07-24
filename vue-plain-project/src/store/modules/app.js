const state = {
  count: 0,
}

const action = {
  async fetchData({ commit, state }, params = null) {
    console.log('this is params: ', params)

    await new Promise((resolve) => setTimeout(resolve, 300))

    commit('SET_COUNT', state.count + 1)
  },
}

const mutation = {
  SET_COUNT(state, count) {
    state.count = count
  },
}

export default {
  namespaced: true,
  state,
  action,
  mutation,
}
