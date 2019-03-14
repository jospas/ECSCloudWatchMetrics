/**
  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
  
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  A copy of the License is located at
  
      http://www.apache.org/licenses/LICENSE-2.0
  
  or in the "license" file accompanying this file. This file is distributed 
  on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either 
  express or implied. See the License for the specific language governing 
  permissions and limitations under the License.
*/

var AWS = require('aws-sdk');
AWS.config.update({region: process.env.REGION});  
var ecs = new AWS.ECS();
var cloudWatch = new AWS.CloudWatch();

/**
 * Looks at a running ECS cluster and extracts CloudWatch metrics
 * about running services.
 * TODO this could be extended to capture task information if required
 */
exports.handler = async (event, context, callback) => {

    console.log('[INFO] starting to generate CloudWatch metrics for ECS');

    try
    {
    	var metrics = [];

    	var clusters = await getClusters();

    	for (var i = 0; i < clusters.length; i++)
    	{	
    		var services = await describeServices(clusters[i]);
    		metrics = metrics.concat(produceMetrics(clusters[i], services));
    	}

    	await sendMetricData(metrics);

    	callback(null, 'Metrics creation complete');
    }
    catch (error)
    {
        console.log('[ERROR] failed to create ECS metrics', error);
        callback(error);
    }
};

/**
 * Submit metrics to CloudWatch
 */
async function sendMetricData(metrics)
{
	console.log('[INFO] sending metrics to CloudWatch: %j', metrics);

	var nameSpace = process.env.CLOUDWATCH_NAMESPACE;

	if (metrics.length > 0)
	{
    	do
    	{
    		var putMetricsRequest = {
    			Namespace: nameSpace,
    			MetricData: []
    		};

    		for (var i = 0; i < 20; i++)
    		{
    			if (metrics.length > 0)
    			{
    				putMetricsRequest.MetricData.push(metrics.shift());
    			}
    			else
    			{
    				break;
    			}
    		}

    		await cloudWatch.putMetricData(putMetricsRequest).promise();
    	}
    	while (metrics.length > 0);
    }
}

/**
 * List all of the running clusters returning an array of cluster details
 * using the cluster format of the ecs.describeClusters response:
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ECS.html#describeClusters-property
 */
async function getClusters() 
{
	var clusterArns = [];
	var clusters = [];

	try
	{
		/**
		 * List the clusters
		 */
		var listParams = { };

		do 
		{
			var listResponseData = await ecs.listClusters(listParams).promise();

			if (listResponseData.clusterArns)
			{
				clusterArns = clusterArns.concat(listResponseData.clusterArns);
			}

			if (listResponseData.nextToken)
			{
				listParams.nextToken = listResponseData.nextToken;
			}
		}
		while (listParams.nextToken);

		console.log('[INFO] found cluster arns: %j', clusterArns);

		if (clusterArns.length > 0)
		{
			/**
			 * Describe each of the clusters in batches of 10
			 */
			do 
			{
				var describeParams = {
					clusters: []
				};

				for (var i = 0; i < 10; i++)
				{
					if (clusterArns.length > 0)
					{ 
						describeParams.clusters.push(clusterArns.shift());
					}
					else
					{
						break;
					}
				}

				var describeResponse = await ecs.describeClusters(describeParams).promise();

				if (describeResponse.clusters)
				{
					clusters = clusters.concat(describeResponse.clusters);
				}
			}
			while (clusterArns.length > 0);		 
		}

		console.log('[INFO] found clusters: %j', clusters);

		return clusters;
	}
	catch (error)
	{
		console.log('[ERROR] failed to list/describe clusters', error);
		throw error;
	}
}

/**
 * Describes services running on a cluster returning an array of 
 * service details using the service format of the ecs.describeServices response:
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ECS.html#describeServices-property
 */
async function describeServices(cluster) 
{
	var serviceArns = [];
	var services = [];

	try
	{
		/**
		 * Find all of the running services for this cluster
		 */
		var listParams =
		{
			cluster: cluster.clusterArn
		};

		do 
		{
			var listResponseData = await ecs.listServices(listParams).promise();

			if (listResponseData.serviceArns)
			{
				serviceArns = serviceArns.concat(listResponseData.serviceArns);
			}

			if (listResponseData.nextToken)
			{
				listParams.nextToken = listResponseData.nextToken;
			}
		}
		while (listParams.nextToken);

		console.log('[INFO] found service arns: %j', serviceArns);

		if (serviceArns.length > 0)
		{
			/**
			 * Describe the running services in batches of 10
			 */
			do 
			{
				var describeParams = 
				{
					cluster: cluster.clusterArn,
					services: []
				};

				for (var i = 0; i < 10; i++)
				{
					if (serviceArns.length > 0)
					{
						describeParams.services.push(serviceArns.shift());
					}
					else
					{
						break;
					}
				}

				var describeResponse = await ecs.describeServices(describeParams).promise();

				if (describeResponse.services)
				{
					services = services.concat(describeResponse.services);
				}
			}
			while (serviceArns.length > 0);
		}

		console.log('[INFO] found services: %j', services);

		return services;
	}
	catch (error)
	{
		console.log('[ERROR] failed to list/describe services', error);
		throw error;
	}
}

/**
 * Produce CloudWatch metrics for the cluster and service
 */
function produceMetrics(cluster, services)
{
	var metrics = [];

	try
	{
		for (var i = 0; i < services.length; i++)
		{
			var service = services[i];

    		metrics.push({
    			'MetricName': 'ECSRunningCount',
    			'Dimensions': [
	        		{
	            		'Name': 'ECS_CLUSTER',
	            		'Value': cluster.clusterName
	        		},
		            {
		                'Name': 'SERVICE_NAME',
		                'Value': service.serviceName
		            }
        		],
        		'Unit': 'Count',
        		'Value': service.runningCount
    		});

			metrics.push({
    			'MetricName': 'ECSDesiredCount',
    			'Dimensions': [
	        		{
	            		'Name': 'ECS_CLUSTER',
	            		'Value': cluster.clusterName
	        		},
		            {
		                'Name': 'SERVICE_NAME',
		                'Value': service.serviceName
		            }
        		],
        		'Unit': 'Count',
        		'Value': service.desiredCount
    		});

			metrics.push({
    			'MetricName': 'ECSPendingCount',
    			'Dimensions': [
	        		{
	            		'Name': 'ECS_CLUSTER',
	            		'Value': cluster.clusterName
	        		},
		            {
		                'Name': 'SERVICE_NAME',
		                'Value': service.serviceName
		            }
        		],
        		'Unit': 'Count',
        		'Value': service.pendingCount
    		});
    	}

    	return metrics;
	}
	catch (error)
	{
		console.log('[ERROR] failed to produce service metrics', error);
		throw error;
	}
}
