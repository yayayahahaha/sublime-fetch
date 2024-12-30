import { fromIni } from '@aws-sdk/credential-providers'
import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetDistributionCommand
} from '@aws-sdk/client-cloudfront'
import { loadingSpinner } from './loading-utils.js'

function generateAwsCloudfrontClient() {
  const cloudFrontClient = new CloudFrontClient({
    // region: 'us-east-1',
    region: 'ap-northeast-1',
    credentials: fromIni({ profile: 'staging' })
  })

  return cloudFrontClient
}

/**
 * @description 列出所有 CloudFront Distribution
 * @TODO 會比較花時間，可以做個 cache 機制
 * */
export async function listCloudFrontDistributions() {
  const client = generateAwsCloudfrontClient()

  const spinner = loadingSpinner()
  const { error, result } = await _recursive([], null)
  spinner.stop()

  if (error != null) return { error }

  const webCloudfront = result.filter(item => {
    const defaultBehaviorTargetOrigin =
      item?.DefaultCacheBehavior?.TargetOriginId
    const originMap = Object.fromEntries(
      item.Origins?.Items.map(origin => [origin.Id, origin])
    )

    return originMap[defaultBehaviorTargetOrigin]?.OriginPath?.match(/webpages/)
  })

  return { error, result, webCloudfront }

  async function _recursive(list, Marker) {
    const command = new ListDistributionsCommand({ Marker })
    const { error, ...response } = await client
      .send(command)
      .catch(error => ({ error }))
    if (error != null) return { error }

    const {
      DistributionList: { NextMarker, IsTruncated, Items }
    } = response
    if (!IsTruncated) return { error, result: list.concat(Items) }

    return await _recursive(list.concat(Items), NextMarker)
  }
}
